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
    const watchSpy = vi.spyOn(watcher as any, "watch").mockResolvedValue(undefined)

    await watcher.start()

    expect(watchSpy).toHaveBeenCalled()

    // Fast forward time to trigger interval
    vi.advanceTimersByTime(1000)
    expect(watchSpy).toHaveBeenCalledTimes(2)
  })

  it("should process logs when found", async () => {
    const currentBlock = 100n
    mockClient.getBlockNumber.mockResolvedValue(currentBlock)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    const mockLogs = [{ id: 1 }, { id: 2 }]
    mockClient.getFilterLogs.mockResolvedValue(mockLogs)

    // Access private method via any cast or just call start which calls watch
    // But start sets interval, so better to call watch directly if possible or mock start
    // Since watch is private, we can cast to any
    await (watcher as any).watch()

    expect(mockClient.getBlockNumber).toHaveBeenCalled()
    expect(mockClient.createContractEventFilter).toHaveBeenCalledWith({
      address: "0x123",
      abi: [],
      eventName: "TestEvent",
      fromBlock: 100n, // First run starts from current block
      toBlock: 100n,
    })
    expect(mockClient.getFilterLogs).toHaveBeenCalledWith({ filter: "mockFilter" })
    expect(mockOnLogs).toHaveBeenCalledWith(mockLogs)
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Detected 2 new TestEvent events"))
  })

  it("should not process logs when none found", async () => {
    mockClient.getBlockNumber.mockResolvedValue(200n)
    mockClient.createContractEventFilter.mockResolvedValue("mockFilter")
    mockClient.getFilterLogs.mockResolvedValue([])

    await (watcher as any).watch()

    expect(mockOnLogs).not.toHaveBeenCalled()
  })

  it("should handle errors gracefully", async () => {
    mockClient.getBlockNumber.mockRejectedValue(new Error("Network error"))

    await (watcher as any).watch()

    expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error))
  })

  it("should update lastBlock correctly", async () => {
    // First run
    mockClient.getBlockNumber.mockResolvedValue(100n)
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
})
