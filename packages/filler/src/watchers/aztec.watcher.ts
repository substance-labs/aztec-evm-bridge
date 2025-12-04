import winston from "winston"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { PXE } from "@aztec/pxe/client/bundle"

import { parseOpenLog, parseResolvedCrossChainOrder } from "../utils/aztec.js"

import type { AztecNode } from "@aztec/aztec.js/node"
import type { ResolvedOrder } from "../types.js"
import type BlockService from "../services/block.service.js"

interface WatcherConfigs {
  service: string
  logger: winston.Logger
  pxe: PXE
  node: AztecNode
  contractAddress: `0x${string}`
  eventName: string
  watchIntervalTimeMs: number
  blockService: BlockService
  onLogs: (logs: ResolvedOrder[]) => Promise<void>
}

class AztecWatcher {
  logger: winston.Logger
  onLogs: (logs: any[]) => Promise<void>
  pxe: PXE
  node: AztecNode
  contractAddress: `0x${string}`
  eventName: string
  blockService: BlockService
  serviceName: string
  private lastBlock: number
  private watchIntervalTimeMs: number

  constructor(configs: WatcherConfigs) {
    this.logger = configs.logger.child({ service: configs.service })
    this.pxe = configs.pxe
    this.node = configs.node
    this.contractAddress = configs.contractAddress
    this.eventName = configs.eventName
    this.onLogs = configs.onLogs
    this.watchIntervalTimeMs = configs.watchIntervalTimeMs
    this.blockService = configs.blockService
    this.serviceName = configs.service

    this.lastBlock = 0
  }

  async start() {
    try {
      const lastBlock = await this.blockService.getLastBlock(this.serviceName)
      if (lastBlock) {
        this.lastBlock = lastBlock
      }

      this.watch()
      setInterval(() => {
        this.watch()
      }, this.watchIntervalTimeMs)
    } catch (error) {}
  }

  private async watch() {
    try {
      const currentBlock = await this.node.getBlockNumber()
      if (!this.lastBlock) {
        this.lastBlock = currentBlock - 1
      }

      const fromBlock = this.lastBlock + 1
      const toBlock = currentBlock + 1
      this.lastBlock = currentBlock
      await this.blockService.setLastBlock(this.serviceName, this.lastBlock)

      if (fromBlock === toBlock) {
        this.logger.info(`no new blocks detected. currentBlock is ${currentBlock}. skipping ...`)
        return
      }

      this.logger.info(`looking for ${this.eventName} events from block ${fromBlock} to block ${toBlock} on Aztec ...`)
      const { logs } = await this.node.getPublicLogs({
        fromBlock,
        toBlock: toBlock,
        contractAddress: AztecAddress.fromString(this.contractAddress),
      })

      // NOTE: At the moment, we use `pack` to emit an event, so we cannot determine the event name.
      // Since this is a workaround, we created an ad-hoc algorithm to detect whether an event is of type Open,
      // in order to filter Open1 and Open2 events.
      // Currently, for the POC, it's enough to check whether `fields[0]` of both logs are the same
      // and that the log index is sequential (e.g., 0 and 1).
      const groupedLogs = logs.reduce((acc: any, obj: any) => {
        const groupKey = obj.log.fields[0].toString()
        if (!acc[groupKey]) {
          acc[groupKey] = []
        }
        acc[groupKey].push(obj)
        return acc
      }, {} as any)

      const joinedLogs = Object.keys(groupedLogs)
        .filter((orderId) => {
          const logs = groupedLogs[orderId].filter(
            ({ log }: { log: any }) => log.getEmittedFields().length === 11 || log.getEmittedFields().length === 13,
          )
          return logs.length === 2
        })
        .map((orderId) => {
          const [open1, open2] = groupedLogs[orderId]
          const open = parseOpenLog(open1.log.fields, open2.log.fields)
          return parseResolvedCrossChainOrder(open.resolvedOrder)
        })

      if (logs.length) {
        this.logger.info(`Detected ${joinedLogs.length} new ${this.eventName} events on Aztec. Processing them ...`)
        await this.onLogs(joinedLogs)
      }
    } catch (error) {
      this.logger.error(error)
    }
  }
}

export default AztecWatcher
