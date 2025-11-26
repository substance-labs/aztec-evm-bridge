import { AbiEvent, Chain, createPublicClient, Hex, http } from "viem"
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { TxReceipt } from "@aztec/aztec.js/tx"
import { sleep } from "@aztec/foundation/sleep"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import { getResolvedOrderByAztecLogs, parseFilledLog } from "../utils"
import { aztecSepolia, FILLED, FILLED_PRIVATELY, gatewayAddresses } from "../constants"
import l2Gateway7683Abi from "../utils/abi/l2Gateway7683"
import type { AztecOperations } from "./AztecOperations"
import type { FilledLog, Order, OrderCallbacks, ResolvedOrder } from "../types"

export class OrderMonitoring {
  aztecOperations: AztecOperations

  constructor(aztecOperations: AztecOperations) {
    this.aztecOperations = aztecOperations
  }

  /**
   * Get Aztec filled log by order ID
   */
  async getAztecFilledLogByOrderId(orderId: Hex): Promise<FilledLog | undefined> {
    const gateway = gatewayAddresses[aztecSepolia.id]
    const { logs } = await (
      await this.aztecOperations.getAztecNodeClient()
    ).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })

    // Filter for Filled events (they have 13 fields: fields[0-12])
    const filledLogs = logs.filter(({ log }) => log.fields.length === 13 && log.fields[11] !== undefined)
    const parsedLogs = filledLogs.map(({ log }) => parseFilledLog(log.fields))

    return parsedLogs.find((log) => log.orderId === orderId)
  }

  /**
   * Get Aztec open log by order ID
   */
  async getAztecOpenLogByOrderId(orderId: Hex): Promise<ResolvedOrder | undefined> {
    const gateway = gatewayAddresses[aztecSepolia.id]
    const { logs } = await (
      await this.aztecOperations.getAztecNodeClient()
    ).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })
    const parsedOpenLogs = getResolvedOrderByAztecLogs(logs)

    return parsedOpenLogs.find((order) => order.orderId === orderId)
  }

  /**
   * Monitor Aztec to EVM order and wait for it to be filled
   */
  async monitorAztecToEvmOrder(
    order: Order,
    receipt: TxReceipt,
    gatewayIn: Hex,
    gatewayOut: Hex,
    chainOut: Chain,
    callbacks?: OrderCallbacks,
  ): Promise<{ transactionHash: Hex; resolvedOrder: ResolvedOrder }> {
    const { onOrderOpened, onOrderFilled } = callbacks || {}

    // Get order from Aztec logs
    const { logs } = await (
      await this.aztecOperations.getAztecNodeClient()
    ).getPublicLogs({
      fromBlock: receipt.blockNumber! - 1,
      toBlock: receipt.blockNumber! + 1,
      contractAddress: AztecAddress.fromString(gatewayIn),
    })
    const [resolvedOrder] = getResolvedOrderByAztecLogs(logs)
    onOrderOpened?.({ orderId: resolvedOrder.orderId, transactionHash: receipt.txHash.toString(), resolvedOrder })

    // Wait for order to be filled on EVM
    const evmPublicClient = createPublicClient({
      chain: chainOut,
      transport: http(),
    })

    const orderFilledTxHash = await this.waitForEvmFilledOrder(evmPublicClient, gatewayOut, resolvedOrder.orderId)
    onOrderFilled?.({ orderId: resolvedOrder.orderId, transactionHash: orderFilledTxHash })

    return { transactionHash: orderFilledTxHash, resolvedOrder }
  }

  /**
   * Wait for an order to be filled on EVM
   */
  private async waitForEvmFilledOrder(evmPublicClient: any, gatewayOut: Hex, orderId: Hex): Promise<Hex> {
    while (true) {
      const result = (await evmPublicClient.readContract({
        address: gatewayOut,
        abi: l2Gateway7683Abi,
        functionName: "filledOrders",
        args: [orderId],
      })) as [Hex, Hex]

      if (result[0] !== "0x" && result[1] !== "0x") break
      await sleep(5000)
    }

    const currentBlock = await evmPublicClient.getBlockNumber()
    const [log] = await evmPublicClient.getLogs({
      address: gatewayOut,
      event: l2Gateway7683Abi.find((el) => el.type === "event" && el.name === "Filled") as AbiEvent,
      args: { orderId },
      fromBlock: currentBlock - 100n,
      toBlock: currentBlock,
    })

    return log.transactionHash
  }

  /**
   * Monitor EVM to Aztec order and wait for it to be filled
   */
  async monitorEvmToAztecOrder(order: Order, orderId: Hex, gatewayOut: Hex, callbacks?: OrderCallbacks): Promise<void> {
    const { onOrderFilled } = callbacks || {}
    await this.aztecOperations.maybeRegisterAztecGateway()

    const wallet = await this.aztecOperations.getAztecWallet()
    const account = await this.aztecOperations.getAztecAccount()

    // Create the gateway contract instance once after registration
    const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)

    let retryCount = 0
    const maxRetries = 10

    while (true) {
      try {
        const status = parseInt(
          await gateway.methods
            .get_order_status(Fr.fromString(orderId))
            .simulate({ from: account.getAddress(), skipTxValidation: true }),
        )

        if (status === FILLED_PRIVATELY || status === FILLED) {
          onOrderFilled?.({ orderId })
          return
        }

        // Reset retry count on successful check
        retryCount = 0
        await sleep(3000)
      } catch (error) {
        retryCount++
        console.error(`Error checking order status (attempt ${retryCount}/${maxRetries}):`, error)

        if (retryCount >= maxRetries) {
          throw new Error(`Failed to check order status after ${maxRetries} attempts: ${error}`)
        }

        // Wait longer before retrying on error
        await sleep(5000)
      }
    }
  }
}
