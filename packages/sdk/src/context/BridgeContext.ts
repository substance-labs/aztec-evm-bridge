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
import {
  defaultChainsConfig,
  DEFAULT_FORWARDER_ADDRESS,
  DEFAULT_AZTEC_ROLLUP_L1_ADDRESS,
  DEFAULT_OP_STACK_ANCHOR_REGISTRY,
  DEFAULT_FORWARDER_CHAIN_ID,
  FORWARDER_CHAIN,
} from "../constants"
import { BridgeConfigs, FilledLog, InternalChain } from "../types"
import * as viemChains from "viem/chains"

export class BridgeContext {
  azguardClient?: AzguardClient
  aztecWallet?: Wallet
  beaconApiUrl?: string
  evmPrivateKey?: Hex
  evmProvider?: Client
  chainsConfig: Record<string, InternalChain>
  forwarderAddress: Hex
  aztecRollupContractL1Address: Hex
  opStackAnchorRegistryAddress: Hex
  forwarderChainId: number
  #forwarderChain?: Chain

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
    this.chainsConfig = configs.chainsConfig ?? defaultChainsConfig
    this.forwarderAddress = configs.forwarderAddress ?? DEFAULT_FORWARDER_ADDRESS
    this.aztecRollupContractL1Address = configs.aztecRollupContractL1Address ?? DEFAULT_AZTEC_ROLLUP_L1_ADDRESS
    this.opStackAnchorRegistryAddress = configs.opStackAnchorRegistryAddress ?? DEFAULT_OP_STACK_ANCHOR_REGISTRY
    this.forwarderChainId = configs.forwarderChainId ?? DEFAULT_FORWARDER_CHAIN_ID
  }

  getAztecConfig() {
    const aztecConfig = this.chainsConfig.aztecDevnet
    if (!aztecConfig) throw new Error("Aztec chain config not found")
    return aztecConfig
  }

  getAztecRpcUrl(): string {
    return this.getAztecConfig().chain.rpcUrls.default.http[0]
  }

  getAztecGatewayAddress(): Hex {
    return this.getAztecConfig().gatewayAddress
  }

  getAztecChainId(): number {
    return this.getAztecConfig().chain.id
  }

  getForwarderChain(): Chain {
    if (!this.#forwarderChain) {
      if (this.forwarderChainId === DEFAULT_FORWARDER_CHAIN_ID) {
        this.#forwarderChain = FORWARDER_CHAIN
      } else {
        const chain = (Object.values(viemChains) as Chain[]).find((c) => c.id === this.forwarderChainId)
        if (!chain) throw new Error(`Forwarder chain not found for ID: ${this.forwarderChainId}`)
        this.#forwarderChain = chain
      }
    }
    return this.#forwarderChain
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
    const chains = Object.values(this.chainsConfig) as InternalChain[]
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
    const chains = Object.values(this.chainsConfig) as InternalChain[]
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
    const aztecConfig = this.chainsConfig.aztecDevnet
    if (!aztecConfig) throw new Error("Aztec chain config not found")
    const gateway = aztecConfig.gatewayAddress
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
        const instance = await createAztecNodeClient(aztecConfig.chain.rpcUrls.default.http[0]).getContract(
          AztecAddress.fromString(gateway),
        )
        if (!instance) {
          throw new Error(`Contract instance not found for gateway address ${gateway}`)
        }
        await wallet.registerContract(instance, AztecGateway7683Contract.artifact)

        // Register the Sponsored FPC contract
        const sponsoredFPC = await getSponsoredFPCInstance(aztecConfig.chain.rpcUrls.default.http[0])
        await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact)
      }
      this.#aztecGatewayRegistered = true
    }
  }

  async getAztecFilledLogByOrderId(orderId: Hex): Promise<FilledLog | undefined> {
    const aztecConfig = this.chainsConfig.aztecDevnet
    if (!aztecConfig) throw new Error("Aztec chain config not found")
    const gateway = aztecConfig.gatewayAddress
    const { logs } = await createAztecNodeClient(aztecConfig.chain.rpcUrls.default.http[0]).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })

    const filledLogs = logs.filter(({ log }) => log.fields.length === 13 && log.fields[11] !== undefined)

    const parsedLogs = filledLogs.map(({ log }) => parseFilledLog(log.fields))
    return parsedLogs.find((log) => log.orderId === orderId)
  }
}
