import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash, TxReceipt } from "@aztec/aztec.js/tx"
import { sleep } from "@aztec/foundation/sleep"
import { AzguardClient } from "@azguardwallet/client"
import { OkResult, SendTransactionResult, SimulateViewsResult } from "@azguardwallet/types"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { Hex } from "viem"
import { AztecGateway7683ContractArtifact } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import { getAztecAddressFromAzguardAccount, hexToUintArray, OrderDataEncoder } from "../utils"
import { aztecSepolia, gatewayAddresses, ORDER_DATA_TYPE, PRIVATE_SENDER } from "../constants"
import type { AztecOperations } from "./AztecOperations"
import type { FillOrderDetails, OrderData } from "../types"

export class AzguardOperations {
  azguardClient: AzguardClient
  aztecOperations: AztecOperations

  constructor(azguardClient: AzguardClient, aztecOperations: AztecOperations) {
    this.azguardClient = azguardClient
    this.aztecOperations = aztecOperations
  }

  /**
   * Get the selected Azguard account (defaults to accounts[0])
   */
  getSelectedAccount(): `aztec:${number}:${string}` {
    // NOTE: Azguard currently doesn't expose the actively selected account.
    // As a workaround, we default to using accounts[0], assuming it's the connected one.
    return this.azguardClient.accounts[0]
  }

  /**
   * Register the Aztec gateway contract with Azguard
   */
  async registerAztecGateway(): Promise<void> {
    const gateway = gatewayAddresses[aztecSepolia.id]
    await this.azguardClient.execute([
      {
        kind: "register_contract",
        chain: `aztec:11155111`,
        address: gateway,
        artifact: AztecGateway7683ContractArtifact,
      },
    ])
  }

  /**
   * Claim a private order using Azguard
   */
  async claimPrivateOrder(orderId: Hex, secret: Hex, originData: Hex, fillerData: Hex): Promise<Hex> {
    const gatewayOut = gatewayAddresses[aztecSepolia.id]
    const selectedAccount = this.getSelectedAccount()

    const [response] = await this.azguardClient.execute([
      {
        kind: "send_transaction",
        account: selectedAccount,
        actions: [
          {
            kind: "call",
            contract: gatewayOut,
            method: "claim_private",
            args: [secret, hexToUintArray(orderId), hexToUintArray(originData), hexToUintArray(fillerData)],
          },
        ],
      },
    ])

    if (response.status === "failed") throw new Error(response.error)
    return (response as OkResult<SendTransactionResult>).result as Hex
  }

  /**
   * Fill an EVM to Aztec order using Azguard
   */
  async fillEvmToAztecOrder(details: FillOrderDetails, isPrivate: boolean): Promise<Hex> {
    const { orderId, orderData } = details
    const chainOut = aztecSepolia
    const gatewayOut = gatewayAddresses[chainOut.id]
    const selectedAccount = this.getSelectedAccount()
    const fillerData = getAztecAddressFromAzguardAccount(selectedAccount)
    const orderDataEncoder = new OrderDataEncoder(orderData)

    const response = await this.azguardClient.execute([
      {
        kind: "register_contract",
        chain: `aztec:11155111`,
        address: orderData.outputToken,
        artifact: TokenContractArtifact,
      },
      {
        kind: "send_transaction",
        account: selectedAccount,
        actions: [
          {
            kind: isPrivate ? "add_private_authwit" : "add_public_authwit",
            content: {
              kind: "call",
              caller: gatewayOut,
              contract: orderData.outputToken,
              method: isPrivate ? "transfer_to_public" : "transfer_in_public",
              args: isPrivate
                ? [
                    getAztecAddressFromAzguardAccount(selectedAccount),
                    AztecAddress.fromString(gatewayOut),
                    orderData.amountOut,
                    orderData.senderNonce,
                  ]
                : [
                    getAztecAddressFromAzguardAccount(selectedAccount),
                    AztecAddress.fromString(orderData.recipient),
                    orderData.amountOut,
                    orderData.senderNonce,
                  ],
            },
          },
          {
            kind: "call",
            contract: gatewayOut,
            method: isPrivate ? "fill_private" : "fill",
            args: [hexToUintArray(orderId), hexToUintArray(orderDataEncoder.encode()), hexToUintArray(fillerData)],
          },
        ],
      },
    ])

    for (const res of response) if (res.status === "failed") throw new Error(res.error)
    return (response[1] as OkResult<SendTransactionResult>).result as Hex
  }

  /**
   * Open an Aztec to EVM order using Azguard
   */
  async openAztecToEvmOrder(
    tokenIn: Hex,
    gatewayIn: Hex,
    orderData: OrderData,
    fillDeadline: number,
    amountIn: bigint,
    nonce: Fr,
    isPrivate: boolean,
  ): Promise<TxReceipt> {
    const selectedAccount = this.getSelectedAccount()
    const orderDataEncoder = new OrderDataEncoder({
      ...orderData,
      sender: isPrivate ? PRIVATE_SENDER : getAztecAddressFromAzguardAccount(selectedAccount),
    })

    const response = await this.azguardClient.execute([
      {
        kind: "register_contract",
        chain: `aztec:11155111`,
        address: tokenIn,
        artifact: TokenContractArtifact,
      },
      {
        kind: "send_transaction",
        account: selectedAccount,
        actions: [
          {
            kind: isPrivate ? "add_private_authwit" : "add_public_authwit",
            content: {
              kind: "call",
              caller: gatewayIn,
              contract: tokenIn,
              method: isPrivate ? "transfer_to_public" : "transfer_in_public",
              args: [getAztecAddressFromAzguardAccount(selectedAccount), gatewayIn, amountIn, nonce],
            },
          },
          {
            kind: "call",
            contract: gatewayIn,
            method: isPrivate ? "open_private" : "open",
            args: [
              {
                fill_deadline: fillDeadline,
                order_data: hexToUintArray(orderDataEncoder.encode()),
                order_data_type: hexToUintArray(ORDER_DATA_TYPE),
              },
            ],
          },
        ],
      },
    ])

    for (const res of response) if (res.status === "failed") throw new Error(res.error)
    const orderOpenedTxHash = (response[1] as OkResult<SendTransactionResult>).result as Hex

    return await this.waitForAztecReceipt(orderOpenedTxHash)
  }

  /**
   * Wait for an Aztec transaction receipt
   */
  async waitForAztecReceipt(txHash: Hex): Promise<TxReceipt> {
    while (true) {
      const receipt = await (await this.aztecOperations.getAztecNodeClient()).getTxReceipt(TxHash.fromString(txHash))

      if (receipt.status === "success") return receipt
      if (receipt.status === "pending") {
        await sleep(5000)
        continue
      }
      throw new Error("Aztec transaction failed")
    }
  }

  /**
   * Get order status using Azguard
   */
  async getOrderStatus(orderId: Hex, gatewayAddress: Hex): Promise<number> {
    const selectedAccount = this.getSelectedAccount()
    const [response] = await this.azguardClient.execute([
      {
        kind: "simulate_views",
        account: selectedAccount,
        calls: [
          {
            kind: "call",
            contract: gatewayAddress,
            method: "get_order_status",
            args: [orderId],
          },
        ],
      },
    ])

    if (response.status === "failed") throw new Error(response.error)
    return parseInt(BigInt((response as OkResult<SimulateViewsResult>).result.encoded[0][0]).toString())
  }

  /**
   * Refund an EVM to Aztec order using Azguard
   */
  async refundEvmToAztecOrder(orderId: Hex, originData: Hex): Promise<Hex> {
    const gatewayOut = gatewayAddresses[aztecSepolia.id]
    const selectedAccount = this.getSelectedAccount()

    const [response] = await this.azguardClient.execute([
      {
        kind: "send_transaction",
        account: selectedAccount,
        actions: [
          {
            kind: "call",
            contract: gatewayOut,
            method: "refund",
            args: [hexToUintArray(orderId), hexToUintArray(originData)],
          },
        ],
      },
    ])

    if (response.status === "failed") throw new Error(response.error)
    return (response as OkResult<SendTransactionResult>).result as Hex
  }

  /**
   * Monitor EVM to Aztec order status using Azguard
   */
  async monitorEvmToAztecOrder(orderId: Hex, gatewayOut: Hex): Promise<void> {
    const selectedAccount = this.getSelectedAccount()

    while (true) {
      const [response] = await this.azguardClient.execute([
        {
          kind: "simulate_views",
          account: selectedAccount,
          calls: [
            {
              kind: "call",
              contract: gatewayOut,
              method: "get_order_status",
              args: [orderId],
            },
          ],
        },
      ])

      if (response.status === "failed") throw new Error(response.error)
      const status = parseInt(BigInt((response as OkResult<SimulateViewsResult>).result.encoded[0][0]).toString())

      // FILLED_PRIVATELY = 2, FILLED = 3
      if (status === 2 || status === 3) {
        return
      }

      await sleep(3000)
    }
  }
}
