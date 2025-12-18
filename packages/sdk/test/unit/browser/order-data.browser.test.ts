import { describe, expect, it } from "vitest"

import type { OrderData } from "../../../src"
import { OrderDataEncoder } from "../../../src"

const hex32 = (value: string) => ("0x" + value.padStart(64, "0").slice(-64)) as `0x${string}`

const sampleOrder: OrderData = {
  sender: hex32("1"),
  recipient: hex32("2"),
  inputToken: hex32("3"),
  outputToken: hex32("4"),
  amountIn: 123456789n,
  amountOut: 987654321n,
  senderNonce: 42n,
  originDomain: 111,
  destinationDomain: 222,
  destinationSettler: hex32("5"),
  fillDeadline: 600,
  orderType: 1,
  data: hex32("6"),
}

describe("OrderDataEncoder (browser)", () => {
  it("encodes and decodes symmetrically", () => {
    const encoder = new OrderDataEncoder(sampleOrder)
    const encoded = encoder.encode()
    const decoded = OrderDataEncoder.decode(encoded)

    expect(decoded).toEqual(sampleOrder)
  })

  it("returns ABI-ready packed tuples", () => {
    const encoder = new OrderDataEncoder(sampleOrder)
    const packed = encoder.toPacked()

    expect(packed.types).toHaveLength(13)
    expect(packed.values[0]).toBe(sampleOrder.sender)
    expect(packed.values[5]).toBe(sampleOrder.amountOut)
  })
})
