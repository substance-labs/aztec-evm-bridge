import { Logger } from "winston"
import { formatEther, formatUnits, erc20Abi } from "viem"
import type MultiClient from "../MultiClient.js"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import type { FillerConfig, EvmChainConfig, AztecChainConfig } from "../config.js"
import type { BalanceRepository } from "../repositories/BalanceRepository.js"
import type { EmbeddedWallet } from "../wallet/EmbeddedWallet.js"

export class Monitor {
  private interval: NodeJS.Timeout | null = null

  constructor(
    private evmMultiClient: MultiClient,
    private aztecWallet: EmbeddedWallet,
    private balanceRepository: BalanceRepository,
    private config: FillerConfig,
    private logger: Logger,
    private minNativeBalance: bigint = 100000000000000000n, // 0.1 ETH
  ) {}

  start() {
    if (this.interval) return
    this.logger.info("Starting Monitor...")
    this.checkBalances()
    this.interval = setInterval(() => this.checkBalances(), this.config.balanceCheckIntervalMs)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private async checkBalances() {
    for (const chainConfig of Object.values(this.config.chains)) {
      if (chainConfig.type === "evm") {
        await this.checkEvmBalance(chainConfig)
      } else if (chainConfig.type === "aztec") {
        await this.checkAztecBalance(chainConfig)
      }
    }
  }

  private async checkEvmBalance(chainConfig: EvmChainConfig) {
    const { chain, tokens } = chainConfig
    if (!chain) return

    // Only monitor balances on chains where we have supported tokens (i.e. filling chains)
    if (tokens.length === 0) return

    try {
      const { publicClient, walletClient } = this.evmMultiClient.getClientByChain(chain)
      if (!walletClient.account) {
        this.logger.warn(`No account found for chain ${chain.name}, skipping balance check`)
        return
      }
      const address = walletClient.account.address

      // Native Balance
      const balance = await publicClient.getBalance({ address })
      this.logger.info(`Native Balance [${chain.name}]: ${formatEther(balance)} ${chain.nativeCurrency.symbol}`)

      await this.balanceRepository.saveBalance({
        chain: chain.name,
        asset: chain.nativeCurrency.symbol,
        address: address,
        balance: balance.toString(),
        timestamp: new Date(),
      })

      if (balance < this.minNativeBalance) {
        this.logger.warn(`LOW Native BALANCE on ${chain.name}: ${formatEther(balance)} ${chain.nativeCurrency.symbol}`)
      }

      // Token Balances
      for (const token of tokens) {
        try {
          const tokenBalance = await publicClient.readContract({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          })
          this.logger.info(
            `Token Balance [${chain.name} - ${token.symbol}]: ${formatUnits(tokenBalance, token.decimals)}`,
          )

          await this.balanceRepository.saveBalance({
            chain: chain.name,
            asset: token.symbol,
            address: address,
            balance: tokenBalance.toString(),
            timestamp: new Date(),
          })
        } catch (e) {
          this.logger.error(`Failed to check token balance for ${token.symbol} on ${chain.name}`, e)
        }
      }
    } catch (err) {
      this.logger.error(`Failed to check balances for ${chain.name}`, err)
    }
  }

  private async checkAztecBalance(chainConfig: AztecChainConfig) {
    try {
      const address = this.aztecWallet.getAddress()
      this.logger.info(`Checking Aztec balances for ${address.toString()}`)

      for (const token of chainConfig.tokens) {
        try {
          const tokenContract = await TokenContract.at(AztecAddress.fromString(token.address), this.aztecWallet)

          // Checking public balance
          const publicBalance = await tokenContract.methods.balance_of_public(address).simulate({ from: address })
          this.logger.info(
            `Aztec Token Balance [${token.symbol}]: ${formatUnits(publicBalance, token.decimals)} (Public)`,
          )

          await this.balanceRepository.saveBalance({
            chain: chainConfig.name,
            asset: `${token.symbol} (Public)`,
            address: address.toString(),
            balance: publicBalance.toString(),
            timestamp: new Date(),
          })

          // Checking private balance
          const privateBalance = await tokenContract.methods.balance_of_private(address).simulate({ from: address })
          this.logger.info(
            `Aztec Token Balance [${token.symbol}]: ${formatUnits(privateBalance, token.decimals)} (Private)`,
          )

          await this.balanceRepository.saveBalance({
            chain: chainConfig.name,
            asset: `${token.symbol} (Private)`,
            address: address.toString(),
            balance: privateBalance.toString(),
            timestamp: new Date(),
          })
        } catch (e) {
          this.logger.error(`Failed to check Aztec token balance for ${token.symbol}`, e)
        }
      }
    } catch (err) {
      this.logger.error("Failed to check Aztec balances", err)
    }
  }
}
