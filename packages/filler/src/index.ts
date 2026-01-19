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

const main = async () => {
  // Log configuration on startup
  const evmChain = config.chains.baseSepolia
  const aztecChain = config.chains.aztec
  logger.info("=== Filler Configuration ===")
  logger.info(`EVM Chain: ${evmChain.name} (ID: ${evmChain.id})`)
  logger.info(`EVM RPC URL: ${evmChain.rpcUrl}`)
  logger.info(`EVM Gateway: ${evmChain.gateway}`)
  logger.info(`EVM Tokens: ${evmChain.tokens.map((t) => `${t.symbol}:${t.address}`).join(", ")}`)
  logger.info(`Aztec Chain: ${aztecChain.name} (ID: ${aztecChain.id})`)
  logger.info(`Aztec RPC URL: ${aztecChain.rpcUrl}`)
  logger.info(`Aztec Gateway: ${aztecChain.gateway}`)
  logger.info(`Aztec Tokens: ${aztecChain.tokens.map((t) => `${t.symbol}:${t.address}`).join(", ")}`)
  logger.info(`Forwarder Address: ${config.forwarderAddress}`)
  logger.info(`Balance Check Interval: ${config.balanceCheckIntervalMs}ms`)
  logger.info("============================")

  const mongoClient = new MongoClient(config.mongo.uri, {
    ...(config.mongo.user && config.mongo.password
      ? { auth: { username: config.mongo.user, password: config.mongo.password } }
      : {}),
    ...(config.mongo.authSource ? { authSource: config.mongo.authSource } : {}),
  })

  try {
    await mongoClient.connect()
  } catch (err) {
    logger.error("Could not connect to MongoDB", err)
    process.exit(1)
  }
  const db = mongoClient.db(config.mongo.dbName)

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

  const l2EvmChain = config.l2EvmChain
  const l1Chain = config.l1Chain

  const evmMultiClient = new MultiClient({
    chains: [l2EvmChain, chains.sepolia],
    privateKey: config.evm.privateKey,
    rpcUrls: {
      [l2EvmChain.id]: evmChain.rpcUrl,
      [l1Chain.id]: config.evm.forwarderRpcUrl,
    },
  })

  // Log filler addresses
  const evmFillerAddress = evmMultiClient.getWalletClientByChain(l2EvmChain).account?.address
  const aztecFillerAddress = orderWallet.getAddress().toString()
  logger.info("=== Filler Addresses ===")
  logger.info(`EVM Filler Address: ${evmFillerAddress}`)
  logger.info(`Aztec Filler Address: ${aztecFillerAddress}`)
  logger.info("========================")

  const orderService = new OrderService({
    aztecWallet: orderWallet,
    evmMultiClient,
    db,
    logger,
  })

  new SettlementService({
    aztecGatewayAddress: aztecChain.gateway,
    aztecWallet: settlementWallet,
    beaconApiUrl: config.evm.beaconApiUrl,
    db,
    evmMultiClient,
    forwarderAddress: config.forwarderAddress,
    l1Chain,
    logger,
    l2EvmChain,
    l2EvmGatewayAddress: evmChain.gateway,
  })

  const balanceRepository = new BalanceRepository(db)
  const chainStateRepository = new ChainStateRepository(db)
  const monitor = new Monitor(evmMultiClient, monitorWallet, balanceRepository, config, logger)
  monitor.start()

  const evmWatcher = new EvmWatcher({
    service: `${l2EvmChain.name.replace(/\s+/g, "")}Watcher`,
    logger,
    client: evmMultiClient.getPublicClientByChain(l2EvmChain),
    contractAddress: evmChain.gateway,
    abi: l2Gateway7683Abi,
    eventName: "Open",
    watchIntervalTimeMs: config.evm.watchIntervalMs,
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
    contractAddress: aztecChain.gateway,
    eventName: "Open",
    watchIntervalTimeMs: config.aztec.watchIntervalMs,
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
