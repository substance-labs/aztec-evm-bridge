import { bytesToHex, encodePacked, hexToBytes } from "viem"
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon"
import { Fr } from "@aztec/aztec.js/fields"

import type { Hex } from "viem"
import type { OrderData } from "../types"

const ORDER_DATA_LENGTH = 301 as const

export const ORDER_DATA_PACKED_TYPES = [
  "bytes32", // sender
  "bytes32", // recipient
  "bytes32", // inputToken
  "bytes32", // outputToken
  "uint256", // amountIn
  "uint256", // amountOut
  "uint256", // senderNonce
  "uint32", // originDomain
  "uint32", // destinationDomain
  "bytes32", // destinationSettler
  "uint32", // fillDeadline
  "uint8", // orderType
  "bytes32", // data
] as const

const OFF = {
  sender: 0, // bytes32
  recipient: 32, // bytes32
  inputToken: 64, // bytes32
  outputToken: 96, // bytes32
  amountIn: 128, // uint256 -> 32 bytes
  amountOut: 160, // uint256 -> 32 bytes
  senderNonce: 192, // uint256 -> 32 bytes
  originDomain: 224, // uint32  -> 4 bytes
  destinationDomain: 228, // uint32  -> 4 bytes
  destinationSettler: 232, // bytes32
  fillDeadline: 264, // uint32  -> 4 bytes
  orderType: 268, // uint8   -> 1 byte
  data: 269, // bytes32
} as const

const read = (b: Uint8Array, off: number, len: number) => b.subarray(off, off + len)
const u32be = (b4: Uint8Array): number => new DataView(b4.buffer, b4.byteOffset, 4).getUint32(0, false)
const u256be = (b32: Uint8Array): bigint => b32.reduce((acc, x) => (acc << 8n) + BigInt(x), 0n)

export type OrderDataTuple = readonly [
  Hex, // bytes32 sender
  Hex, // bytes32 recipient
  Hex, // bytes32 inputToken
  Hex, // bytes32 outputToken
  bigint, // amountIn
  bigint, // amountOut
  bigint, // senderNonce
  number, // originDomain (uint32)
  number, // destinationDomain (uint32)
  Hex, // bytes32 destinationSettler
  number, // fillDeadline (uint32)
  number, // orderType (uint8)
  Hex, // bytes32 data
]

export interface OrderDataPacked {
  types: typeof ORDER_DATA_PACKED_TYPES
  values: OrderDataTuple
}

export class OrderDataEncoder {
  #sender: Hex
  #recipient: Hex
  #inputToken: Hex
  #outputToken: Hex
  #amountIn: bigint
  #amountOut: bigint
  #senderNonce: bigint
  #originDomain: number
  #destinationDomain: number
  #destinationSettler: Hex
  #fillDeadline: number
  #orderType: number
  #data: Hex

  constructor(params: OrderData) {
    this.#sender = params.sender
    this.#recipient = params.recipient
    this.#inputToken = params.inputToken
    this.#outputToken = params.outputToken
    this.#amountIn = params.amountIn
    this.#amountOut = params.amountOut
    this.#senderNonce = params.senderNonce
    this.#originDomain = params.originDomain
    this.#destinationDomain = params.destinationDomain
    this.#destinationSettler = params.destinationSettler
    this.#fillDeadline = params.fillDeadline
    this.#orderType = params.orderType
    this.#data = params.data
  }

  toPacked(): OrderDataPacked {
    const values: OrderDataTuple = [
      this.#sender,
      this.#recipient,
      this.#inputToken,
      this.#outputToken,
      this.#amountIn,
      this.#amountOut,
      this.#senderNonce,
      this.#originDomain,
      this.#destinationDomain,
      this.#destinationSettler,
      this.#fillDeadline,
      this.#orderType,
      this.#data,
    ]
    return { types: ORDER_DATA_PACKED_TYPES, values }
  }

  static decode(packed: Hex): OrderData {
    const bytes = hexToBytes(packed)
    if (bytes.length !== ORDER_DATA_LENGTH) {
      throw new Error(`Invalid OrderData length: got ${bytes.length}, expected ${ORDER_DATA_LENGTH}`)
    }

    const sender = bytesToHex(read(bytes, OFF.sender, 32))
    const recipient = bytesToHex(read(bytes, OFF.recipient, 32))
    const inputToken = bytesToHex(read(bytes, OFF.inputToken, 32))
    const outputToken = bytesToHex(read(bytes, OFF.outputToken, 32))
    const amountIn = u256be(read(bytes, OFF.amountIn, 32))
    const amountOut = u256be(read(bytes, OFF.amountOut, 32))
    const senderNonce = u256be(read(bytes, OFF.senderNonce, 32))
    const originDomain = u32be(read(bytes, OFF.originDomain, 4))
    const destinationDomain = u32be(read(bytes, OFF.destinationDomain, 4))
    const destinationSettler = bytesToHex(read(bytes, OFF.destinationSettler, 32))
    const fillDeadline = u32be(read(bytes, OFF.fillDeadline, 4))
    const orderType = read(bytes, OFF.orderType, 1)[0]
    const data = bytesToHex(read(bytes, OFF.data, 32)) as Hex

    return {
      sender,
      recipient,
      inputToken,
      outputToken,
      amountIn,
      amountOut,
      senderNonce,
      originDomain,
      destinationDomain,
      destinationSettler,
      fillDeadline,
      orderType,
      data,
    }
  }

  encode(): Hex {
    const { types, values } = this.toPacked()
    return encodePacked(types, values)
  }

  // TODO: understand why sometimes it returns a wrong id
  async id() {
    return await poseidon2Hash([
      Fr.fromBufferReduce(Buffer.from(this.#sender.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.#recipient.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.#inputToken.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.#outputToken.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.#amountIn.toString(16), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.#amountOut.toString(16), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.#senderNonce.toString(16), "hex")),
      Fr.fromHexString("0x" + this.#originDomain.toString(16)),
      Fr.fromHexString("0x" + this.#destinationDomain.toString(16)),
      Fr.fromBufferReduce(Buffer.from(this.#destinationSettler.slice(2), "hex")),
      Fr.fromHexString("0x" + this.#fillDeadline.toString(16)),
      Fr.fromHexString("0x" + this.#orderType.toString(16)),
      Fr.fromBufferReduce(Buffer.from(this.#data.slice(2), "hex")),
    ])
  }
}
