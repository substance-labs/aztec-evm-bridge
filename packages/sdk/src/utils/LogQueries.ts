import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Hex } from "viem"

import { chainsConfig } from "../constants"
import { getResolvedOrderByAztecLogs, parseFilledLog } from "./index"
import type { FilledLog, ResolvedOrder } from "../types"

/**
 * Utilities for querying Aztec gateway logs
 */
export class LogQueries {
  /**
   * Find a filled order log by order ID
   * Searches through Aztec gateway public logs for a filled event matching the given order ID
   *
   * @param orderId - The order ID to search for
   * @returns The filled log if found, undefined otherwise
   */
  static async getAztecFilledLogByOrderId(orderId: Hex): Promise<FilledLog | undefined> {
    // TODO: understand why if i use fromBlock and toBlock i always receive the penultimate log.
    // Basically i never receive the last one even if block numbers are up to date
    const gateway = chainsConfig.aztecDevnet.gatewayAddress
    const { logs } = await createAztecNodeClient(chainsConfig.aztecDevnet.chain.rpcUrls.default.http[0]).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })

    // Filter for Filled events (they have 13 fields: fields[0-12])
    // Open events have 13 fields but different structure
    const filledLogs = logs.filter(({ log }) => log.fields.length === 13 && log.fields[11] !== undefined)

    const parsedLogs = filledLogs.map(({ log }) => parseFilledLog(log.fields))
    return parsedLogs.find((log) => log.orderId === orderId)
  }

  /**
   * Find an opened order by order ID
   * Searches through Aztec gateway public logs for an open event matching the given order ID
   *
   * @param orderId - The order ID to search for
   * @returns The resolved order if found, undefined otherwise
   */
  static async getAztecOpenLogByOrderId(orderId: Hex): Promise<ResolvedOrder | undefined> {
    // TODO: understand why if i use fromBlock and toBlock i always receive the penultimate log.
    // Basically i never receive the last one even if block numbers are up to date
    const gateway = chainsConfig.aztecDevnet.gatewayAddress
    const { logs } = await createAztecNodeClient(chainsConfig.aztecDevnet.chain.rpcUrls.default.http[0]).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })
    const parsedOpenLogs = getResolvedOrderByAztecLogs(logs)
    return parsedOpenLogs.find((order) => order.orderId === orderId)
  }
}
