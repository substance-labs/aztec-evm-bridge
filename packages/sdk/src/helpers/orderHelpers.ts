import { Fr } from "@aztec/aztec.js/fields"
import { padHex, Hex } from "viem"
import { computeSecretHash } from "@aztec/stdlib/hash"
import { OrderDataEncoder } from "../utils"
import {
  PRIVATE_ORDER,
  PRIVATE_ORDER_WITH_HOOK,
  PRIVATE_SENDER,
  PUBLIC_ORDER,
  PUBLIC_ORDER_WITH_HOOK,
} from "../constants"
import type { Order, OrderData } from "../types"

/**
 * Get the order type constant from the mode string
 */
export function getOrderType(mode: Order["mode"]): number {
  switch (mode) {
    case "private":
      return PRIVATE_ORDER
    case "privateWithHook":
      return PRIVATE_ORDER_WITH_HOOK
    case "public":
      return PUBLIC_ORDER
    case "publicWithHook":
      return PUBLIC_ORDER_WITH_HOOK
    default:
      throw new Error("Invalid mode")
  }
}

/**
 * Check if an order mode is private
 */
export function isPrivateMode(mode: Order["mode"]): boolean {
  return mode.includes("private")
}

/**
 * Create base order data from an Order
 */
export function createBaseOrderData(
  order: Order,
  nonce: Fr,
  gatewayOut: Hex,
  orderType: number,
): Omit<OrderData, "sender" | "recipient"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { amountIn, amountOut, chainIdIn, chainIdOut, data, recipient, tokenIn, tokenOut } = order
  const fillDeadline = order.fillDeadline ?? 2 ** 32 - 1

  return {
    inputToken: padHex(tokenIn),
    outputToken: padHex(tokenOut),
    amountIn,
    amountOut,
    senderNonce: nonce.toBigInt(),
    originDomain: chainIdIn,
    destinationDomain: chainIdOut,
    destinationSettler: padHex(gatewayOut),
    fillDeadline,
    orderType,
    data: data || padHex("0x"),
  }
}

/**
 * Create order data for Aztec to EVM flow
 */
export async function createAztecToEvmOrderData(
  order: Order,
  sender: Hex,
  nonce: Fr,
  gatewayOut: Hex,
): Promise<{ orderData: OrderData; orderDataEncoder: OrderDataEncoder }> {
  const isPrivate = isPrivateMode(order.mode)
  const orderType = getOrderType(order.mode)
  const baseData = createBaseOrderData(order, nonce, gatewayOut, orderType)

  const orderData: OrderData = {
    ...baseData,
    sender: isPrivate ? PRIVATE_SENDER : sender,
    recipient: padHex(order.recipient),
  }

  return {
    orderData,
    orderDataEncoder: new OrderDataEncoder(orderData),
  }
}

/**
 * Create order data for EVM to Aztec flow with optional secret
 */
export async function createEvmToAztecOrderData(
  order: Order,
  sender: Hex,
  nonce: Fr,
  gatewayOut: Hex,
  secret: Fr | null,
): Promise<{ orderData: OrderData; orderDataEncoder: OrderDataEncoder }> {
  const isPrivate = isPrivateMode(order.mode)
  const orderType = isPrivate ? PRIVATE_ORDER : PUBLIC_ORDER
  const baseData = createBaseOrderData(order, nonce, gatewayOut, orderType)

  const recipient = secret ? (await computeSecretHash(secret)).toString() : padHex(order.recipient)

  const orderData: OrderData = {
    ...baseData,
    sender: padHex(sender),
    recipient,
  }

  return {
    orderData,
    orderDataEncoder: new OrderDataEncoder(orderData),
  }
}

/**
 * Validate order parameters
 */
export function validateOrder(order: Order): void {
  const { chainIdIn, chainIdOut, mode, data } = order

  if (chainIdIn === chainIdOut) {
    throw new Error("Invalid chains: source and destination must differ")
  }

  const validModes = ["private", "public", "privateWithHook", "publicWithHook"]
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid mode: ${mode}`)
  }

  if (data.length !== 66) {
    throw new Error("Invalid data: must be 32 bytes")
  }
}
