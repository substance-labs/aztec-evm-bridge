import { Hex } from "viem"
import { AzguardClient } from "@azguardwallet/client"
import { chainsConfig } from "./constants"
import type {
  BridgeConfigs,
  FillOrderDetails,
  ForwardDetails,
  Order,
  OrderCallbacks,
  OrderResult,
  RefundOrderDetails,
} from "./types"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { BridgeContext } from "./context/BridgeContext"
import { AztecToEvmOperations } from "./operations/AztecToEvmOperations"
import { EvmToAztecOperations } from "./operations/EvmToAztecOperations"
import { ForwardOperations } from "./operations/ForwardOperations"

export class Bridge {
  private context: BridgeContext
  private aztecToEvmOps: AztecToEvmOperations
  private evmToAztecOps: EvmToAztecOperations
  private forwardOps: ForwardOperations

  // Public properties for backward compatibility or direct access if needed
  public get azguardClient(): AzguardClient | undefined {
    return this.context.azguardClient
  }
  public get aztecWallet(): Wallet | undefined {
    return this.context.aztecWallet
  }
  public get beaconApiUrl(): string | undefined {
    return this.context.beaconApiUrl
  }
  public get evmPrivateKey(): Hex | undefined {
    return this.context.evmPrivateKey
  }
  public get evmProvider(): any {
    return this.context.evmProvider
  }

  private constructor(configs: BridgeConfigs) {
    this.context = new BridgeContext(configs)
    this.aztecToEvmOps = new AztecToEvmOperations(this.context)
    this.evmToAztecOps = new EvmToAztecOperations(this.context)
    this.forwardOps = new ForwardOperations(this.context)
  }

  static async create(configs: BridgeConfigs): Promise<Bridge> {
    const bridge = new Bridge(configs)

    // Initialize contracts for non-Azguard wallets
    if (!bridge.azguardClient) {
      await bridge.context.maybeRegisterAztecGateway()
    }

    return bridge
  }

  async openOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const validModes = ["private", "public", "privateWithHook", "publicWithHook"]
    const { chainIdIn, chainIdOut, mode, data } = order

    if (chainIdIn === chainIdOut) throw new Error("Invalid chains: only cross-chain orders are supported")
    if (!validModes.includes(mode)) throw new Error(`Invalid mode: ${mode}`)
    if (data.length !== 66) throw new Error("Invalid data: must be 32 bytes")

    if (chainIdIn === chainsConfig.aztecDevnet.chain.id) {
      return this.aztecToEvmOps.openOrder(order, callbacks)
    } else if (chainIdOut === chainsConfig.aztecDevnet.chain.id) {
      return this.evmToAztecOps.openOrder(order, callbacks)
    } else {
      throw new Error("Neither chain is Aztec")
    }
  }

  async fillOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderData } = details
    if (orderData.fillDeadline <= Math.floor(Date.now() / 1000)) throw new Error("Order expired")

    if (orderData.originDomain === chainsConfig.aztecDevnet.chain.id) {
      return this.aztecToEvmOps.fillOrder(details)
    } else if (orderData.destinationDomain === chainsConfig.aztecDevnet.chain.id) {
      return this.evmToAztecOps.fillOrder(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  async refundOrder(details: RefundOrderDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    if (chainIdIn === chainsConfig.aztecDevnet.chain.id) {
      return this.aztecToEvmOps.refundOrder(details)
    } else if (chainIdOut === chainsConfig.aztecDevnet.chain.id) {
      return this.evmToAztecOps.refundOrder(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  async claimEvmToAztecPrivateOrder(orderId: Hex, secret: Hex): Promise<Hex> {
    return this.evmToAztecOps.claimEvmToAztecPrivateOrder(orderId, secret)
  }

  async forwardRefundOrder(details: ForwardDetails): Promise<Hex> {
    return this.forwardOps.forwardRefundOrder(details)
  }

  async forwardSettleOrder(details: ForwardDetails): Promise<Hex> {
    return this.forwardOps.forwardSettleOrder(details)
  }

  async finalizeForwardRefundOrder(details: ForwardDetails): Promise<Hex> {
    return this.forwardOps.finalizeForwardRefundOrder(details)
  }

  async finalizeForwardSettleOrder(details: ForwardDetails): Promise<Hex> {
    return this.forwardOps.finalizeForwardSettleOrder(details)
  }
}
