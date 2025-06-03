import { encodePacked } from "viem"
import { poseidon2Hash } from "@aztec/foundation/crypto"
import { Fr } from "@aztec/aztec.js"

export interface OrderDataParams {
  sender: `0x${string}`
  recipient: `0x${string}`
  inputToken: `0x${string}`
  outputToken: `0x${string}`
  amountIn: bigint
  amountOut: bigint
  senderNonce: bigint
  originDomain: number
  destinationDomain: number
  destinationSettler: `0x${string}`
  fillDeadline: number
  orderType: number
  data: `0x${string}`
}

export class OrderData {
  sender: `0x${string}`
  recipient: `0x${string}`
  inputToken: `0x${string}`
  outputToken: `0x${string}`
  amountIn: bigint
  amountOut: bigint
  senderNonce: bigint
  originDomain: number
  destinationDomain: number
  destinationSettler: `0x${string}`
  fillDeadline: number
  orderType: number
  data: `0x${string}`

  constructor(params: OrderDataParams) {
    this.sender = params.sender
    this.recipient = params.recipient
    this.inputToken = params.inputToken
    this.outputToken = params.outputToken
    this.amountIn = params.amountIn
    this.amountOut = params.amountOut
    this.senderNonce = params.senderNonce
    this.originDomain = params.originDomain
    this.destinationDomain = params.destinationDomain
    this.destinationSettler = params.destinationSettler
    this.fillDeadline = params.fillDeadline
    this.orderType = params.orderType
    this.data = params.data
  }

  encode() {
    return encodePacked(
      [
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint32",
        "uint32",
        "bytes32",
        "uint32",
        "uint8",
        "bytes32",
      ],
      [
        this.sender,
        this.recipient,
        this.inputToken,
        this.outputToken,
        this.amountIn,
        this.amountOut,
        this.senderNonce,
        this.originDomain,
        this.destinationDomain,
        this.destinationSettler,
        this.fillDeadline,
        this.orderType,
        this.data,
      ],
    )
  }

  async id() {
    return await poseidon2Hash([
      Fr.fromBufferReduce(Buffer.from(this.sender.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.recipient.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.inputToken.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.outputToken.slice(2), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.amountIn.toString(16), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.amountOut.toString(16), "hex")),
      Fr.fromBufferReduce(Buffer.from(this.senderNonce.toString(16), "hex")),
      Fr.fromHexString("0x" + this.originDomain.toString(16)),
      Fr.fromHexString("0x" + this.destinationDomain.toString(16)),
      Fr.fromBufferReduce(Buffer.from(this.destinationSettler.slice(2), "hex")),
      Fr.fromHexString("0x" + this.fillDeadline.toString(16)),
      Fr.fromHexString("0x" + this.orderType.toString(16)),
      Fr.fromBufferReduce(Buffer.from(this.data.slice(2), "hex")),
    ])
  }
}
