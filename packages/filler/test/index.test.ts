import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { MongoClient } from "mongodb"
import { EmbeddedWallet } from "../src/wallet/EmbeddedWallet.js"
import MultiClient from "../src/MultiClient.js"
import OrderService from "../src/services/order.service.js"
import SettlementService from "../src/services/settlement.service.js"
import { Monitor } from "../src/services/monitor.service.js"
import EvmWatcher from "../src/watchers/evm.watcher.js"
import AztecWatcher from "../src/watchers/aztec.watcher.js"
import logger from "../src/utils/logger.js"

import { BalanceRepository } from "../src/repositories/BalanceRepository.js"
import { ChainStateRepository } from "../src/repositories/ChainStateRepository.js"

// Mock dependencies
vi.mock("mongodb")
vi.mock("../src/wallet/EmbeddedWallet.js")
vi.mock("../src/MultiClient.js")
vi.mock("../src/services/order.service.js")
vi.mock("../src/services/settlement.service.js")
vi.mock("../src/services/monitor.service.js")
vi.mock("../src/watchers/evm.watcher.js")
vi.mock("../src/watchers/aztec.watcher.js")
vi.mock("../src/utils/logger.js")
vi.mock("../src/repositories/BalanceRepository.js")
vi.mock("../src/repositories/ChainStateRepository.js")
vi.mock("viem/chains", () => ({
  sepolia: { id: 11155111, name: "Sepolia" },
  customChain: { id: 456, name: "Custom Chain" },
  customL2: { id: 123, name: "Custom L2" },
}))
vi.mock("../src/config.js", () => ({
  config: {
    chains: {
      aztec: { name: "Aztec", id: "aztec", rpcUrl: "http://localhost:8080", tokens: [] },
      baseSepolia: {
        name: "Base Sepolia",
        id: 84532,
        rpcUrl: "http://localhost:8545",
        gateway: "0x123",
        tokens: [{ symbol: "USDC", address: "0xUSDC" }],
      },
    },
    mongo: { uri: "mongodb://localhost:27017", dbName: "filler" },
    evm: { forwarderChainId: "11155111", privateKey: "0x123", forwarderRpcUrl: "http://localhost:8546" },
    aztec: { isSandbox: false },
    l2EvmChain: { id: 84532, name: "Base Sepolia" },
    l1Chain: { id: 1, name: "Ethereum" },
  },
}))

describe("index.ts", () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv }
    process.env.NODE_ENV = "test"
    process.env.AZTEC_GATEWAY_ADDRESS = "0xAztecGateway"
    process.env.L2_EVM_GATEWAY_ADDRESS = "0xEvmGateway"
    process.env.FORWARDER_ADDRESS = "0xForwarder"
    process.env.FORWARDER_RPC_URL = "http://forwarder-rpc"
    process.env.PK_EVM = "0xPrivateK"
    process.env.EVM_L2_RPC_URL = "http://evm-l2-rpc"
    process.env.BEACON_API_URL = "http://beacon-api"
    process.env.EVM_WATCH_INTERVAL_TIME_MS = "1000"
    process.env.AZTEC_WATCH_INTERVAL_TIME_MS = "2000"
    process.env.MONGO_DB_URI = "mongodb://localhost:27017"
    process.env.EVM_L2_CHAIN_ID = "123"
    process.env.FORWARDER_CHAIN_ID = "456"

    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("should initialize everything correctly", async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined)
    const mockDb = vi.fn().mockReturnValue({})

    const MockMongoClient = class {
      connect = mockConnect
      db = mockDb
    }
    vi.mocked(MongoClient).mockImplementation(MockMongoClient as any)

    vi.mocked(EmbeddedWallet.create).mockResolvedValue({
      getAddress: vi.fn().mockReturnValue({ toString: () => "0xAztec" }),
    } as any)

    const MockMultiClient = class {
      getPublicClientByChain = vi.fn()
      getWalletClientByChain = vi.fn().mockReturnValue({ account: { address: "0x123" } })
    }
    vi.mocked(MultiClient).mockImplementation(MockMultiClient as any)

    const mockEvmWatcherStart = vi.fn()
    let evmWatcherOptions: any
    const MockEvmWatcher = class {
      constructor(options: any) {
        evmWatcherOptions = options
      }
      start = mockEvmWatcherStart
    }
    vi.mocked(EvmWatcher).mockImplementation(MockEvmWatcher as any)

    const mockAztecWatcherStart = vi.fn()
    let aztecWatcherOptions: any
    const MockAztecWatcher = class {
      constructor(options: any) {
        aztecWatcherOptions = options
      }
      start = mockAztecWatcherStart
    }
    vi.mocked(AztecWatcher).mockImplementation(MockAztecWatcher as any)

    const mockMonitorStart = vi.fn()
    const MockMonitor = class {
      start = mockMonitorStart
    }
    vi.mocked(Monitor).mockImplementation(MockMonitor as any)

    const mockOrderService = {
      fillOrderFromEvmLog: vi.fn(),
      fillOrderFromAztecLog: vi.fn(),
    }
    const MockOrderService = class {
      fillOrderFromEvmLog = mockOrderService.fillOrderFromEvmLog
      fillOrderFromAztecLog = mockOrderService.fillOrderFromAztecLog
    }
    vi.mocked(OrderService).mockImplementation(MockOrderService as any)
    vi.mocked(SettlementService).mockImplementation(class {} as any)
    vi.mocked(BalanceRepository).mockImplementation(class {} as any)
    vi.mocked(ChainStateRepository).mockImplementation(class {} as any)

    const { main } = await import("../src/index.js")
    await main()

    expect(MongoClient).toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalled()
    expect(EmbeddedWallet.create).toHaveBeenCalledTimes(3)
    expect(MultiClient).toHaveBeenCalled()
    expect(OrderService).toHaveBeenCalled()
    expect(SettlementService).toHaveBeenCalled()
    expect(Monitor).toHaveBeenCalled()
    expect(mockMonitorStart).toHaveBeenCalled()
    expect(EvmWatcher).toHaveBeenCalled()
    expect(mockEvmWatcherStart).toHaveBeenCalled()
    expect(AztecWatcher).toHaveBeenCalled()
    expect(mockAztecWatcherStart).toHaveBeenCalled()
    expect(ChainStateRepository).toHaveBeenCalled()

    // Verify watchers receive chainStateRepository
    expect(evmWatcherOptions.chainStateRepository).toBeDefined()
    expect(evmWatcherOptions.chainId).toBeDefined()
    expect(aztecWatcherOptions.chainStateRepository).toBeDefined()
    expect(aztecWatcherOptions.chainId).toBe("aztec")

    // Test callbacks
    const mockLog = { some: "log" }
    await evmWatcherOptions.onLogs([mockLog])
    expect(mockOrderService.fillOrderFromEvmLog).toHaveBeenCalledWith(mockLog, "aztec")

    await aztecWatcherOptions.onLogs([mockLog])
    expect(mockOrderService.fillOrderFromAztecLog).toHaveBeenCalledWith(mockLog, "Base Sepolia")
  })

  it("should handle MongoDB connection error", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called")
    })
    const mockConnect = vi.fn().mockRejectedValue(new Error("Connection failed"))

    const MockMongoClient = class {
      connect = mockConnect
    }
    vi.mocked(MongoClient).mockImplementation(MockMongoClient as any)

    const { main } = await import("../src/index.js")

    await expect(main()).rejects.toThrow("process.exit called")

    expect(logger.error).toHaveBeenCalledWith("Could not connect to MongoDB", expect.any(Error))
    expect(mockExit).toHaveBeenCalledWith(1)
  })
})
