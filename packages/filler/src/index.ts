import "dotenv/config"
import * as chains from "viem/chains"
import { MongoClient } from "mongodb"

import EvmWatcher from "./watchers/evm.watcher.js"
import AztecWatcher from "./watchers/aztec.watcher.js"
import OrderService from "./services/order.service.js"
import SettlementService from "./services/settlement.service.js"
import { Monitor } from "./services/monitor.service.js"
import { BalanceRepository } from "./repositories/BalanceRepository.js"
import { ChainStateRepository } from "./repositories/ChainStateRepository.js"
import { config, type AztecChainConfig } from "./config.js"
import logger from "./utils/logger.js"
import MultiClient from "./MultiClient.js"
import { getAztecNode } from "./utils/aztec.js"
import l2Gateway7683Abi from "./abis/l2Gateway7683.js"

import type { Log } from "viem"
import { EmbeddedWallet } from "./wallet/EmbeddedWallet.js"

const AZTEC_GATEWAY_ADDRESS = process.env.AZTEC_GATEWAY_ADDRESS as `0x${string}`
const L2_EVM_GATEWAY_ADDRESS = process.env.L2_EVM_GATEWAY_ADDRESS as `0x${string}`
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS as `0x${string}`
const FORWARDER_RPC_URL = process.env.FORWARDER_RPC_URL as string
const PK_EVM = process.env.PK_EVM as `0x${string}`
const EVM_L2_RPC_URL = process.env.EVM_L2_RPC_URL as string
const BEACON_API_URL = process.env.BEACON_API_URL as string
const EVM_WATCH_INTERVAL_TIME_MS = Number(process.env.EVM_WATCH_INTERVAL_TIME_MS as string)
const AZTEC_WATCH_INTERVAL_TIME_MS = Number(process.env.AZTEC_WATCH_INTERVAL_TIME_MS as string)

const main = async () => {
  const mongoUri = (process.env.MONGO_DB_URI as string) || "mongodb://localhost:27017"
  const mongoUser = process.env.MONGO_DB_USER as string | undefined
  const mongoPassword = process.env.MONGO_DB_PASSWORD as string | undefined
  const mongoAuthSource = process.env.MONGO_DB_AUTH_SOURCE as string | undefined
  const mongoDbName = (process.env.MONGO_DB_NAME as string) || "filler"

  const mongoClient = new MongoClient(mongoUri, {
    ...(mongoUser && mongoPassword ? { auth: { username: mongoUser, password: mongoPassword } } : {}),
    ...(mongoAuthSource ? { authSource: mongoAuthSource } : {}),
  })

  try {
    await mongoClient.connect()
  } catch (err) {
    logger.error("Could not connect to MongoDB", err)
    process.exit(1)
  }
  const db = mongoClient.db(mongoDbName)

  // TODO: add possibility to register senders
  const orderWallet = await EmbeddedWallet.create(config.chains.aztec as AztecChainConfig, "filler-order-service-pxe")
  const settlementWallet = await EmbeddedWallet.create(
    config.chains.aztec as AztecChainConfig,
    "filler-settlement-service-pxe",
  )
  const monitorWallet = await EmbeddedWallet.create(
    config.chains.aztec as AztecChainConfig,
    "filler-monitor-service-pxe",
  )

  const l2EvmChain = (Object.values(chains) as chains.Chain[]).find(
    ({ id }) => id.toString() === (process.env.EVM_L2_CHAIN_ID as string),
  ) as chains.Chain
  const l1Chain = (Object.values(chains) as chains.Chain[]).find(
    ({ id }) => id.toString() === (process.env.FORWARDER_CHAIN_ID as string),
  ) as chains.Chain

  const evmMultiClient = new MultiClient({
    chains: [l2EvmChain, chains.sepolia],
    privateKey: PK_EVM,
    rpcUrls: {
      [l2EvmChain.id]: EVM_L2_RPC_URL,
      [l1Chain.id]: FORWARDER_RPC_URL,
    },
  })

  const orderService = new OrderService({
    aztecWallet: orderWallet,
    evmMultiClient,
    db,
    logger,
  })

  new SettlementService({
    aztecGatewayAddress: AZTEC_GATEWAY_ADDRESS,
    aztecWallet: settlementWallet,
    beaconApiUrl: BEACON_API_URL,
    db,
    evmMultiClient,
    forwarderAddress: FORWARDER_ADDRESS,
    l1Chain,
    logger,
    l2EvmChain,
    l2EvmGatewayAddress: L2_EVM_GATEWAY_ADDRESS,
  })

  const balanceRepository = new BalanceRepository(db)
  const chainStateRepository = new ChainStateRepository(db)
  const monitor = new Monitor(evmMultiClient, monitorWallet, balanceRepository, config, logger)
  monitor.start()

  const evmWatcher = new EvmWatcher({
    service: `${l2EvmChain.name.replace(/\s+/g, "")}Watcher`,
    logger,
    client: evmMultiClient.getPublicClientByChain(l2EvmChain),
    contractAddress: L2_EVM_GATEWAY_ADDRESS,
    abi: l2Gateway7683Abi,
    eventName: "Open",
    watchIntervalTimeMs: EVM_WATCH_INTERVAL_TIME_MS,
    chainStateRepository,
    chainId: `evm-${l2EvmChain.id}`,
    onLogs: async (logs: Log[]) => {
      for (const log of logs) {
        console.log("Filling order from L2 EVM log:", log)
        await orderService.fillOrderFromEvmLog(log, "aztec")
      }
    },
  })

  const aztecWatcher = new AztecWatcher({
    service: "AztecWatcher",
    logger,
    wallet: orderWallet,
    contractAddress: AZTEC_GATEWAY_ADDRESS,
    eventName: "Open",
    watchIntervalTimeMs: AZTEC_WATCH_INTERVAL_TIME_MS,
    chainStateRepository,
    chainId: "aztec",
    onLogs: async (logs) => {
      for (const log of logs) {
        await orderService.fillOrderFromAztecLog(log, "Base Sepolia")
      }
    },
  })

  evmWatcher.start()
  aztecWatcher.start()
}

if (process.env.NODE_ENV !== "test") {
  main()
}

export { main }
