import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import winston from "winston"
import EvmWatcher from "../src/watchers/evm.watcher.js"

// Mock winston
const mockLogger = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  error: vi.fn(),
} as unknown as winston.Logger

// Mock viem client
const mockClient = {
  chain: { name: "mockChain" },
  getBlockNumber: vi.fn(),
  createContractEventFilter: vi.fn(),
  getFilterLogs: vi.fn(),
}

// Mock ChainStateRepository
const mockChainStateRepository = {
  getLastProcessedBlock: vi.fn(),
  setLastProcessedBlock: vi.fn(),
}

describe("EvmWatcher", () => {
  let watcher: EvmWatcher
  const mockOnLogs = vi.fn()
  const config = {
    service: "test-service",
    logger: mockLogger,
    client: mockClient,
    contractAddress: "0x123" as `0x${string}`,
    abi: [],
    eventName: "TestEvent",
    watchIntervalTimeMs: 1000,
    onLogs: mockOnLogs,
    chainStateRepository: mockChainStateRepository,
    chainId: "test-chain-1",
    maxBlockRange: 10,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    watcher = new EvmWatcher(config)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should initialize correctly", () => {
    expect(watcher).toBeDefined()
    expect(mockLogger.child).toHaveBeenCalledWith({ service: "test-service" })
  })

  it("should start watching and set interval", async () => {
    mockChainStateRepository.getLastProcessedBlock.mockResolvedValue(null)
    mockClient.getBlockNumber.mockResolvedValue(100n)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    mockClient.getFilterLogs.mockResolvedValue([])

    await watcher.start()

    expect(mockChainStateRepository.getLastProcessedBlock).toHaveBeenCalledWith("test-chain-1")
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("No saved block found for chain test-chain-1"))

    // Fast forward time to trigger interval
    vi.advanceTimersByTime(1000)
  })

  it("should resume from saved block", async () => {
    mockChainStateRepository.getLastProcessedBlock.mockResolvedValue(50n)
    mockClient.getBlockNumber.mockResolvedValue(55n)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    mockClient.getFilterLogs.mockResolvedValue([])

    await watcher.start()

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Resuming from saved block 50"))
  })

  it("should process logs when found", async () => {
    // Set lastBlock to avoid catch-up logic
    watcher["lastBlock"] = 99n
    const currentBlock = 100n
    mockClient.getBlockNumber.mockResolvedValue(currentBlock)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    const mockLogs = [{ id: 1 }, { id: 2 }]
    mockClient.getFilterLogs.mockResolvedValue(mockLogs)

    await (watcher as any).watch()

    expect(mockClient.getBlockNumber).toHaveBeenCalled()
    expect(mockClient.createContractEventFilter).toHaveBeenCalledWith({
      address: "0x123",
      abi: [],
      eventName: "TestEvent",
      fromBlock: 100n,
      toBlock: 100n,
    })
    expect(mockClient.getFilterLogs).toHaveBeenCalledWith({ filter: "mockFilter" })
    expect(mockOnLogs).toHaveBeenCalledWith(mockLogs)
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Detected 2 new TestEvent events"))
    expect(mockChainStateRepository.setLastProcessedBlock).toHaveBeenCalledWith("test-chain-1", 100n)
  })

  it("should not process logs when none found", async () => {
    watcher["lastBlock"] = 199n
    mockClient.getBlockNumber.mockResolvedValue(200n)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    mockClient.getFilterLogs.mockResolvedValue([])

    await (watcher as any).watch()

    expect(mockOnLogs).not.toHaveBeenCalled()
    expect(mockChainStateRepository.setLastProcessedBlock).toHaveBeenCalledWith("test-chain-1", 200n)
  })

  it("should handle errors gracefully", async () => {
    mockClient.getBlockNumber.mockRejectedValue(new Error("Network error"))

    await (watcher as any).watch()

    expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error))
  })

  it("should update lastBlock correctly", async () => {
    // First run
    watcher["lastBlock"] = 99n
    mockClient.getBlockNumber.mockResolvedValue(100n)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    mockClient.getFilterLogs.mockResolvedValue([])
    await (watcher as any).watch()

    // Second run
    mockClient.getBlockNumber.mockResolvedValue(105n)
    await (watcher as any).watch()

    expect(mockClient.createContractEventFilter).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromBlock: 101n, // lastBlock (100) + 1
        toBlock: 105n,
      }),
    )
  })

  it("should skip watch when already catching up", async () => {
    watcher["isCatchingUp"] = true
    mockClient.getBlockNumber.mockResolvedValue(100n)

    await (watcher as any).watch()

    expect(mockClient.getBlockNumber).not.toHaveBeenCalled()
  })

  it("should skip watch when already up to date", async () => {
    watcher["lastBlock"] = 100n
    mockClient.getBlockNumber.mockResolvedValue(100n)

    await (watcher as any).watch()

    expect(mockClient.createContractEventFilter).not.toHaveBeenCalled()
  })

  it("should trigger catch-up when behind by more than maxBlockRange", async () => {
    watcher["lastBlock"] = 50n
    mockClient.getBlockNumber.mockResolvedValue(100n) // 50 blocks behind > maxBlockRange (10)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    mockClient.getFilterLogs.mockResolvedValue([])

    await (watcher as any).watch()

    // Should have called catchUp, which processes in chunks
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Catching up"))
  })

  it("should catch up in chunks when far behind", async () => {
    watcher["lastBlock"] = 80n
    mockClient.getBlockNumber.mockResolvedValue(100n) // 20 blocks behind
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    mockClient.getFilterLogs.mockResolvedValue([])

    await (watcher as any).catchUp()

    // Should process in chunks of 10
    expect(mockChainStateRepository.setLastProcessedBlock).toHaveBeenCalledWith("test-chain-1", 90n)
    expect(mockChainStateRepository.setLastProcessedBlock).toHaveBeenCalledWith("test-chain-1", 100n)
  })

  it("should not catch up if within maxBlockRange", async () => {
    watcher["lastBlock"] = 95n
    mockClient.getBlockNumber.mockResolvedValue(100n) // Only 5 blocks behind

    await (watcher as any).catchUp()

    // Should not log catching up
    expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining("Catching up"))
  })

  it("should handle errors during catch-up", async () => {
    watcher["lastBlock"] = 50n
    mockClient.getBlockNumber.mockRejectedValue(new Error("Network error"))

    await (watcher as any).catchUp()

    expect(mockLogger.error).toHaveBeenCalledWith("Error during catch-up:", expect.any(Error))
    expect(watcher["isCatchingUp"]).toBe(false)
  })
})
