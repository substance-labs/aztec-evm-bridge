import { Chain, Client, createWalletClient, custom, Hex, http } from "viem"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { AccountWithSecretKey } from "@aztec/aztec.js/account"
import { Wallet } from "@aztec/aztec.js/wallet"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { AzguardClient } from "@azguardwallet/client"
import { privateKeyToAccount } from "viem/accounts"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import { AztecGateway7683ContractArtifact } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { getSponsoredFPCInstance, parseFilledLog } from "../utils"
import { chainsConfig } from "../constants"
import { BridgeConfigs, FilledLog, InternalChain, Order } from "../types"

export class BridgeContext {
  azguardClient?: AzguardClient
  aztecWallet?: Wallet
  beaconApiUrl?: string
  evmPrivateKey?: Hex
  evmProvider?: Client

  #wallet?: Wallet
  #account?: AccountWithSecretKey
  #aztecGatewayRegistered = false

  constructor(configs: BridgeConfigs) {
    const { azguardClient, aztecWallet, beaconApiUrl, evmPrivateKey, evmProvider } = configs

    if (!aztecWallet && !azguardClient) {
      throw new Error("You must specify aztecWallet or azguardClient")
    }

    if (evmPrivateKey && evmProvider) {
      throw new Error("Cannot specify both evmPrivateKey and evmProvider")
    }

    if (azguardClient && aztecWallet) {
      throw new Error("Cannot specify both azguardClient and aztecWallet")
    }

    this.azguardClient = azguardClient
    this.aztecWallet = aztecWallet
    this.beaconApiUrl = beaconApiUrl
    this.evmPrivateKey = evmPrivateKey
    this.evmProvider = evmProvider
  }

  async getAztecWallet(): Promise<Wallet> {
    if (!this.#wallet) {
      if (!this.aztecWallet) {
        throw new Error("No Aztec wallet provided. Please provide an aztecWallet in BridgeConfigs.")
      }
      this.#wallet = this.aztecWallet
    }

    return this.#wallet
  }

  async getAztecAccount(): Promise<AccountWithSecretKey> {
    if (!this.#account) {
      const wallet = await this.getAztecWallet()

      // Get the first registered account from the wallet
      const accounts = await wallet.getAccounts()
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts found in the provided wallet. Please register an account with the wallet first.")
      }

      // Get the account from the wallet's internal account management
      const accountAddress = accounts[0].item
      this.#account = (await (wallet as any).getAccountFromAddress(accountAddress)) as AccountWithSecretKey

      if (!this.#account) {
        throw new Error(`Could not retrieve account ${accountAddress.toString()} from wallet`)
      }
    }

    return this.#account!
  }

  getChainInAndOutByChainIds(
    chainIdIn: number,
    chainIdOut: number,
  ): {
    chainIn: InternalChain
    chainOut: InternalChain
  } {
    return {
      chainIn: this.getChainByChainId(chainIdIn),
      chainOut: this.getChainByChainId(chainIdOut),
    }
  }

  getChainByChainId(chainId: number): InternalChain {
    const chains = Object.values(chainsConfig) as InternalChain[]
    const chain = chains.find((c) => c.chain.id === chainId)
    if (!chain) throw new Error("Chain not supported")
    return chain
  }

  async getEvmWalletClientAndAddress(chain: Chain) {
    const walletClient = this.evmProvider
      ? createWalletClient({
          chain,
          transport: custom(this.evmProvider),
        })
      : createWalletClient({
          chain,
          account: privateKeyToAccount(this.evmPrivateKey!),
          transport: http(),
        })

    let address
    if (walletClient.account) {
      // privateKeyToAccount
      address = walletClient.account.address
    } else {
      // window.ethereum
      ;[address] = await walletClient.getAddresses()
    }
    return {
      walletClient,
      address,
    }
  }

  getGatewaysByChainIds(
    chainIdIn: number,
    chainIdOut: number,
  ): {
    gatewayIn: Hex
    gatewayOut: Hex
  } {
    const chains = Object.values(chainsConfig) as InternalChain[]
    const chainIn = chains.find((c) => c.chain.id === chainIdIn)
    if (!chainIn) throw new Error("Unsupported source chain")
    const gatewayIn = chainIn.gatewayAddress
    const chainOut = chains.find((c) => c.chain.id === chainIdOut)
    if (!chainOut) throw new Error("Unsupported destination chain")
    const gatewayOut = chainOut.gatewayAddress
    return {
      gatewayIn,
      gatewayOut,
    }
  }

  async maybeRegisterAztecGateway(): Promise<void> {
    const gateway = chainsConfig.aztecDevnet.gatewayAddress
    if (!this.#aztecGatewayRegistered) {
      if (this.azguardClient) {
        await this.azguardClient!.execute([
          {
            kind: "register_contract",
            chain: `aztec:11155111`,
            address: gateway,
            artifact: AztecGateway7683ContractArtifact,
          },
        ])
      } else {
        const wallet = await this.getAztecWallet()
        const instance = await createAztecNodeClient(
          chainsConfig.aztecDevnet.chain.rpcUrls.default.http[0],
        ).getContract(AztecAddress.fromString(gateway))
        if (!instance) {
          throw new Error(`Contract instance not found for gateway address ${gateway}`)
        }
        await wallet.registerContract(instance, AztecGateway7683Contract.artifact)

        // Register the Sponsored FPC contract
        const sponsoredFPC = await getSponsoredFPCInstance()
        await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact)
      }
      this.#aztecGatewayRegistered = true
    }
  }

  async getAztecFilledLogByOrderId(orderId: Hex): Promise<FilledLog | undefined> {
    // TODO: understand why if i use fromBlock and toBlock i always receive the penultimante log.
    // Basically i never receive the last one even if block numbers are up to date
    const gateway = chainsConfig.aztecDevnet.gatewayAddress
    const { logs } = await createAztecNodeClient(chainsConfig.aztecDevnet.chain.rpcUrls.default.http[0]).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })

    // Filter for Filled events (they have 13 fields: fields[0-12])
    // Open events have 13 fields but different structure
    const filledLogs = logs.filter(({ log }) => log.fields.length === 13 && log.fields[11] !== undefined)

    const parsedLogs = filledLogs.map(({ log }) => parseFilledLog(log.fields))
    return parsedLogs.find((log) => log.orderId === orderId)
  }
}
