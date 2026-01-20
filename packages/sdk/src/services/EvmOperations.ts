/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Chain,
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  erc20Abi,
  Hex,
  http,
  keccak256,
  padHex,
  PublicClient,
  WalletClient,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import * as evmChains from "viem/chains"
import { OrderDataEncoder } from "../utils"
import { approveTokens, checkTokenBalance } from "../helpers/tokenOperations"
import { defaultChainsConfig } from "../constants"
import l2Gateway7683Abi from "../utils/abi/l2Gateway7683"
import type { FillOrderDetails, InternalChain, OrderData } from "../types"

export class EvmOperations {
  evmPrivateKey?: Hex
  evmProvider?: any
  chainsConfig: Record<string, InternalChain>

  constructor(
    evmPrivateKey?: Hex,
    evmProvider?: any,
    chainsConfig: Record<string, InternalChain> = defaultChainsConfig,
  ) {
    this.evmPrivateKey = evmPrivateKey
    this.evmProvider = evmProvider
    this.chainsConfig = chainsConfig
  }

  private getGatewayAddressByChainId(chainId: number): Hex {
    const chain = Object.values(this.chainsConfig).find((c) => c.chain.id === chainId)
    if (!chain) {
      throw new Error(`No gateway configured for chain ID ${chainId}`)
    }
    return chain.gatewayAddress
  }

  /**
   * Get EVM wallet client and address for a specific chain
   */
  async getEvmWalletClientAndAddress(chain: Chain): Promise<{
    walletClient: WalletClient
    address: Hex
  }> {
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

    let address: Hex
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

  /**
   * Get chain by chain ID
   */
  getChainByChainId(chainId: number): Chain {
    const chains = [...Object.values(evmChains)]
    const chain = chains.find((c) => c.id === chainId)
    if (!chain) throw new Error(`Chain not found for chain ID ${chainId}`)
    return chain as Chain
  }

  /**
   * Create public client for a chain
   */
  createPublicClient(chain: Chain): PublicClient {
    return createPublicClient({
      chain,
      transport: http(),
    })
  }

  /**
   * Fill an order on EVM (Aztec -> EVM flow)
   */
  async fillAztecToEvmOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderId, orderData } = details
    const chainOut = this.getChainByChainId(orderData.destinationDomain)
    const gatewayOut = this.getGatewayAddressByChainId(chainOut.id)

    const { address, walletClient } = await this.getEvmWalletClientAndAddress(chainOut)
    const fillerData = padHex(address)

    const publicClient = this.createPublicClient(chainOut)
    const outputTokenAddress = `0x${orderData.outputToken.slice(26)}` as Hex

    // Check balance and approve tokens
    await checkTokenBalance(publicClient, outputTokenAddress, address, orderData.amountOut)
    await approveTokens(
      walletClient,
      publicClient,
      outputTokenAddress,
      gatewayOut,
      orderData.amountOut,
      address,
      chainOut,
      this.evmPrivateKey,
    )

    // Fill the order
    const orderDataEncoder = new OrderDataEncoder(orderData)
    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: gatewayOut,
      args: [orderId, orderDataEncoder.encode(), fillerData],
      chain: chainOut,
      functionName: "fill",
    })
  }

  /**
   * Refund an Aztec to EVM order
   */
  async refundAztecToEvmOrder(
    orderId: Hex,
    chainOut: Chain,
    fillDeadline: number | undefined,
    originData: Hex | undefined,
  ): Promise<Hex> {
    const gatewayOut = this.getGatewayAddressByChainId(chainOut.id)
    const { walletClient, address } = await this.getEvmWalletClientAndAddress(chainOut)

    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: gatewayOut,
      args: [
        [
          {
            fillDeadline,
            orderDataType: "0x" as Hex, // ORDER_DATA_TYPE
            orderData: originData,
          },
        ],
      ],
      chain: chainOut,
      functionName: "refund",
    })
  }
}
