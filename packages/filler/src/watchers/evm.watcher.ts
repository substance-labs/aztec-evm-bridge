import winston from "winston"

import type { PublicClient, Log, Filter } from "viem"
import type { ChainStateRepository } from "../repositories/ChainStateRepository.js"

interface WatcherConfigs {
  service: string
  logger: winston.Logger
  client: any
  contractAddress: `0x${string}`
  abi: any
  eventName: string
  watchIntervalTimeMs: number
  onLogs: (logs: Log[]) => Promise<void>
  chainStateRepository: ChainStateRepository
  chainId: string
  maxBlockRange?: number
}

class EvmWatcher {
  logger: winston.Logger
  onLogs: (logs: Log[]) => Promise<void>
  client: PublicClient
  contractAddress: `0x${string}`
  abi: any
  eventName: string
  private lastBlock: bigint
  private watchIntervalTimeMs: number
  private chainStateRepository: ChainStateRepository
  private chainId: string
  private maxBlockRange: number
  private isCatchingUp: boolean

  constructor(configs: WatcherConfigs) {
    this.logger = configs.logger.child({ service: configs.service })
    this.client = configs.client
    this.contractAddress = configs.contractAddress
    this.abi = configs.abi
    this.eventName = configs.eventName
    this.onLogs = configs.onLogs
    this.watchIntervalTimeMs = configs.watchIntervalTimeMs
    this.chainStateRepository = configs.chainStateRepository
    this.chainId = configs.chainId
    this.maxBlockRange = configs.maxBlockRange ?? 10

    this.lastBlock = 0n
    this.isCatchingUp = false
  }

  async start() {
    try {
      // Load last processed block from database
      const savedBlock = await this.chainStateRepository.getLastProcessedBlock(this.chainId)
      if (savedBlock !== null) {
        this.lastBlock = savedBlock
        this.logger.info(`Resuming from saved block ${savedBlock} for chain ${this.chainId}`)
      } else {
        this.logger.info(`No saved block found for chain ${this.chainId}, will start from latest`)
      }

      // Immediately start catching up if needed
      await this.catchUp()

      this.watch()
      setInterval(() => {
        this.watch()
      }, this.watchIntervalTimeMs)
    } catch (error) {}
  }

  private async catchUp() {
    if (this.isCatchingUp) return
    this.isCatchingUp = true

    try {
      const currentBlock = await this.client.getBlockNumber()
      if (!this.lastBlock) {
        this.lastBlock = currentBlock - 1n
      }

      const blocksToProcess = currentBlock - this.lastBlock
      if (blocksToProcess <= BigInt(this.maxBlockRange)) {
        this.isCatchingUp = false
        return // No need to catch up in chunks
      }

      this.logger.info(
        `Catching up ${blocksToProcess} blocks in chunks of ${this.maxBlockRange} on ${this.client.chain!.name} ...`,
      )

      while (this.lastBlock < currentBlock) {
        const fromBlock = this.lastBlock + 1n
        const toBlock =
          fromBlock + BigInt(this.maxBlockRange) - 1n > currentBlock
            ? currentBlock
            : fromBlock + BigInt(this.maxBlockRange) - 1n

        await this.fetchAndProcessLogs(fromBlock, toBlock)

        this.lastBlock = toBlock
        await this.chainStateRepository.setLastProcessedBlock(this.chainId, toBlock)
      }

      this.logger.info(`Catch-up complete for ${this.client.chain!.name}, now at block ${this.lastBlock}`)
    } catch (error) {
      this.logger.error("Error during catch-up:", error)
    } finally {
      this.isCatchingUp = false
    }
  }

  private async watch() {
    // If still catching up, skip this watch cycle
    if (this.isCatchingUp) return

    try {
      const currentBlock = await this.client.getBlockNumber()
      if (!this.lastBlock) {
        this.lastBlock = currentBlock - 1n
      }

      const blocksToProcess = currentBlock - this.lastBlock
      // If we're behind by more than maxBlockRange, trigger catch-up
      if (blocksToProcess > BigInt(this.maxBlockRange)) {
        await this.catchUp()
        return
      }

      if (this.lastBlock >= currentBlock) {
        return // Already up to date
      }

      const fromBlock = this.lastBlock + 1n
      const toBlock = currentBlock

      await this.fetchAndProcessLogs(fromBlock, toBlock)

      this.lastBlock = currentBlock
      await this.chainStateRepository.setLastProcessedBlock(this.chainId, currentBlock)
    } catch (error) {
      this.logger.error(error)
    }
  }

  private async fetchAndProcessLogs(fromBlock: bigint, toBlock: bigint) {
    this.logger.info(
      `looking for ${this.eventName} events from block ${fromBlock} to block ${toBlock} on ${this.client.chain!.name} ...`,
    )

    const filter = await this.client.createContractEventFilter({
      address: this.contractAddress,
      abi: this.abi,
      eventName: this.eventName,
      fromBlock,
      toBlock,
    })
    const logs = (await this.client.getFilterLogs({ filter: filter as Filter })) as Log[]

    if (logs.length) {
      this.logger.info(
        `Detected ${logs.length} new ${this.eventName} events on ${this.client.chain!.name}. Processing them ...`,
      )
      await this.onLogs(logs)
    }
  }
}

export default EvmWatcher
