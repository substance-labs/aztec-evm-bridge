import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Hex } from "viem"

import { defaultChainsConfig } from "../constants"
import { getResolvedOrderByAztecLogs, parseFilledLog } from "./index"
import type { FilledLog, InternalChain, ResolvedOrder } from "../types"

export interface LogQueriesConfig {
  aztecGatewayAddress: Hex
  aztecRpcUrl: string
}

function getDefaultConfig(): LogQueriesConfig {
  const aztecConfig = defaultChainsConfig.aztecDevnet
  return {
    aztecGatewayAddress: aztecConfig.gatewayAddress,
    aztecRpcUrl: aztecConfig.chain.rpcUrls.default.http[0],
  }
}

/**
 * Utilities for querying Aztec gateway logs
 */
export class LogQueries {
  /**
   * Find a filled order log by order ID
   * Searches through Aztec gateway public logs for a filled event matching the given order ID
   *
   * @param orderId - The order ID to search for
   * @param config - Optional config with gateway address and RPC URL
   * @returns The filled log if found, undefined otherwise
   */
  static async getAztecFilledLogByOrderId(orderId: Hex, config?: LogQueriesConfig): Promise<FilledLog | undefined> {
    const { aztecGatewayAddress, aztecRpcUrl } = config ?? getDefaultConfig()
    const { logs } = await createAztecNodeClient(aztecRpcUrl).getPublicLogs({
      contractAddress: AztecAddress.fromString(aztecGatewayAddress),
    })

    const filledLogs = logs.filter(({ log }) => log.fields.length === 13 && log.fields[11] !== undefined)

    const parsedLogs = filledLogs.map(({ log }) => parseFilledLog(log.fields))
    return parsedLogs.find((log) => log.orderId === orderId)
  }

  /**
   * Find an opened order by order ID
   * Searches through Aztec gateway public logs for an open event matching the given order ID
   *
   * @param orderId - The order ID to search for
   * @param config - Optional config with gateway address and RPC URL
   * @returns The resolved order if found, undefined otherwise
   */
  static async getAztecOpenLogByOrderId(orderId: Hex, config?: LogQueriesConfig): Promise<ResolvedOrder | undefined> {
    const { aztecGatewayAddress, aztecRpcUrl } = config ?? getDefaultConfig()
    const { logs } = await createAztecNodeClient(aztecRpcUrl).getPublicLogs({
      contractAddress: AztecAddress.fromString(aztecGatewayAddress),
    })
    const parsedOpenLogs = getResolvedOrderByAztecLogs(logs)
    return parsedOpenLogs.find((order) => order.orderId === orderId)
  }
}
