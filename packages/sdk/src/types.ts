/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Chain, Hex } from "viem"
import type { AzguardClient } from "@azguardwallet/client"
import type { Fr } from "@aztec/aztec.js/fields"
import type { Wallet } from "@aztec/aztec.js/wallet"

export enum ChainType {
  AZTEC = "AZTEC",
  EVM = "EVM",
}

export type FilledLog = {
  orderId: `0x${string}`
  fillerData: `0x${string}`
  originData: `0x${string}`
}

export interface ResolvedOrder {
  user: `0x${string}`
  originChainId: number
  openDeadline: number
  fillDeadline: number
  orderId: `0x${string}`
  maxSpent: Output[]
  minReceived: Output[]
  fillInstructions: FillInstruction[]
}

export interface Output {
  token: `0x${string}`
  recipient: `0x${string}`
  chainId: number
  amount: bigint
}

export interface FillInstruction {
  destinationSettler: `0x${string}`
  originData: `0x${string}`
  destinationChainId: number
}

export type Mode = "private" | "public"
export type SwapMode = Mode | "privateWithHook" | "publicWithHook"

export type AztecChain = {
  id: number
  name: string
  rpcUrls: {
    [key: string]: {
      http: readonly string[]
    }
    default: {
      http: readonly string[]
    }
  }
}

export type InternalChain =
  | {
      type: ChainType.EVM
      chain: Chain
      gatewayAddress: `0x${string}`
    }
  | {
      type: ChainType.AZTEC
      chain: AztecChain
      gatewayAddress: `0x${string}`
    }

export interface Order {
  chainIdIn: number
  chainIdOut: number
  amountIn: bigint
  amountOut: bigint
  tokenIn: Hex
  tokenOut: Hex
  recipient: Hex
  mode: SwapMode
  data: Hex
  fillDeadline?: number
}

export interface OrderData {
  sender: Hex
  recipient: Hex
  inputToken: Hex
  outputToken: Hex
  amountIn: bigint
  amountOut: bigint
  senderNonce: bigint
  originDomain: number // uint32
  destinationDomain: number // uint32
  destinationSettler: Hex
  fillDeadline: number // uint32 (unix seconds)
  orderType: number // uint8
  data: Hex // bytes32 expected when packing
}

export interface FillOrderDetails {
  orderId: Hex
  orderData: OrderData
}

export interface RefundOrderDetails {
  orderId: Hex
  chainIdIn: number
  chainIdOut: number
  chainIdForwarder?: number
}

export type ForwardToAztecDetails = {
  orderId: Hex
  chainIdIn: number
  chainIdOut: number
  chainIdForwarder?: number
  fillerData?: Hex
}

export type ForwardDetails = {
  orderId: Hex
  chainIdIn: number
  chainIdOut: number
  chainIdForwarder?: number
  fillerData?: Hex
  originData?: Hex
  fillTransactionHash?: Hex
}

export type ForwardDetailsInternal = ForwardDetails & {
  orderId: Hex
  chainIdIn: number
  chainIdOut: number
  chainIdForwarder?: number
  fillerData?: Hex
  type: "forwardSettleToL2" | "forwardRefundToL2" | "forwardSettleToAztec" | "forwardRefundToAztec"
}

export interface OrderResult {
  orderOpenedTxHash: Hex
  // NOTE: on aztec we cannot get the filled transaction hash where a given log has been emitted
  orderFilledTxHash?: Hex
  orderClaimedTxHash?: Hex
  resolvedOrder: ResolvedOrder
}

export interface OrderCallbacks {
  onSecret?: (params: { orderId: Hex; secret: Hex }) => void
  onOrderOpened?: (params: { orderId: Hex; resolvedOrder: ResolvedOrder; transactionHash: Hex }) => void
  onOrderFilled?: (params: { orderId: Hex; transactionHash?: Hex }) => void
  onOrderClaimed?: (params: { orderId: Hex; transactionHash: Hex }) => void
}

export interface BridgeConfigs {
  azguardClient?: AzguardClient
  aztecWallet?: Wallet
  beaconApiUrl?: string
  evmPrivateKey?: Hex
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  evmProvider?: any
  chainsConfig?: Record<string, InternalChain>
  forwarderAddress?: Hex
  aztecRollupContractL1Address?: Hex
  opStackAnchorRegistryAddress?: Hex
  forwarderChainId?: number
}
