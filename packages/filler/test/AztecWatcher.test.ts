import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import winston from "winston"
import AztecWatcher from "../src/watchers/aztec.watcher.js"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import * as AztecUtils from "../src/utils/aztec.js"

// Mock dependencies
vi.mock("@aztec/aztec.js/addresses", () => ({
  AztecAddress: {
    fromString: vi.fn().mockReturnValue("mockAztecAddress"),
  },
}))

vi.mock("../src/utils/aztec.js", () => ({
  parseOpenLog: vi.fn(),
  parseResolvedCrossChainOrder: vi.fn(),
}))

// Mock winston
const mockLogger = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  error: vi.fn(),
} as unknown as winston.Logger

// Mock PXE and Node
const mockPxe = {} as any
const mockNode = {
  getBlockNumber: vi.fn(),
  getPublicLogs: vi.fn(),
} as any

const mockWallet = {
  getAztecNode: vi.fn().mockReturnValue(mockNode),
} as any

// Mock ChainStateRepository
const mockChainStateRepository = {
  getLastProcessedBlock: vi.fn(),
  setLastProcessedBlock: vi.fn(),
}

describe("AztecWatcher", () => {
  let watcher: AztecWatcher
  const mockOnLogs = vi.fn()
  const config = {
    service: "test-service",
    logger: mockLogger,
    wallet: mockWallet,
    contractAddress: "0x123" as `0x${string}`,
    eventName: "TestEvent",
    watchIntervalTimeMs: 1000,
    onLogs: mockOnLogs,
    chainStateRepository: mockChainStateRepository,
    chainId: "aztec-test",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    watcher = new AztecWatcher(config)
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
    mockNode.getBlockNumber.mockResolvedValue(100)
    mockNode.getPublicLogs.mockResolvedValue({ logs: [] })

    await watcher.start()

    expect(mockChainStateRepository.getLastProcessedBlock).toHaveBeenCalledWith("aztec-test")
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("No saved block found for chain aztec-test"))
  })

  it("should resume from saved block", async () => {
    mockChainStateRepository.getLastProcessedBlock.mockResolvedValue(50n)
    mockNode.getBlockNumber.mockResolvedValue(55)
    mockNode.getPublicLogs.mockResolvedValue({ logs: [] })

    await watcher.start()

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Resuming from saved block 50"))
    // After watch() runs, lastBlock is updated to currentBlock (55)
    // But the fromBlock should have started from 51
    expect(mockNode.getPublicLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 51,
      }),
    )
  })

  it("should skip if no new blocks", async () => {
    mockNode.getBlockNumber.mockResolvedValue(100)
    // Set initial lastBlock
    watcher["lastBlock"] = 100

    await (watcher as any).watch()

    expect(mockNode.getPublicLogs).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("no new blocks detected"))
  })

  it("should process logs correctly", async () => {
    mockNode.getBlockNumber.mockResolvedValue(100)
    watcher["lastBlock"] = 90

    // Mock logs structure
    // The watcher expects logs grouped by fields[0] (orderId)
    // And expects 2 logs per group with specific field lengths (11 or 13)
    const mockLog1 = {
      log: {
        fields: ["orderId1", "field1"],
        getEmittedFields: () => new Array(11).fill("field"),
      },
    }
    const mockLog2 = {
      log: {
        fields: ["orderId1", "field2"],
        getEmittedFields: () => new Array(13).fill("field"),
      },
    }

    mockNode.getPublicLogs.mockResolvedValue({ logs: [mockLog1, mockLog2] })

    const mockParsedOpenLog = { resolvedOrder: "mockResolvedOrder" }
    const mockParsedOrder = { orderId: "orderId1" }

    vi.mocked(AztecUtils.parseOpenLog).mockReturnValue(mockParsedOpenLog as any)
    vi.mocked(AztecUtils.parseResolvedCrossChainOrder).mockReturnValue(mockParsedOrder as any)

    await (watcher as any).watch()

    expect(mockNode.getPublicLogs).toHaveBeenCalledWith({
      fromBlock: 91,
      toBlock: 101,
      contractAddress: "mockAztecAddress",
    })

    expect(AztecUtils.parseOpenLog).toHaveBeenCalled()
    expect(AztecUtils.parseResolvedCrossChainOrder).toHaveBeenCalledWith("mockResolvedOrder")
    expect(mockOnLogs).toHaveBeenCalledWith([mockParsedOrder])
    expect(mockChainStateRepository.setLastProcessedBlock).toHaveBeenCalledWith("aztec-test", 100n)
  })

  it("should filter incomplete log groups", async () => {
    mockNode.getBlockNumber.mockResolvedValue(100)
    watcher["lastBlock"] = 90

    // Only one log for this orderId
    const mockLog1 = {
      log: {
        fields: ["orderId1", "field1"],
        getEmittedFields: () => new Array(11).fill("field"),
      },
    }

    mockNode.getPublicLogs.mockResolvedValue({ logs: [mockLog1] })

    await (watcher as any).watch()

    expect(mockOnLogs).toHaveBeenCalledWith([])
    expect(mockChainStateRepository.setLastProcessedBlock).toHaveBeenCalledWith("aztec-test", 100n)
  })

  it("should handle errors gracefully", async () => {
    mockNode.getBlockNumber.mockRejectedValue(new Error("Network error"))

    await (watcher as any).watch()

    expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error))
  })

  it("should initialize lastBlock on first watch when no saved block", async () => {
    mockNode.getBlockNumber.mockResolvedValue(100)
    mockNode.getPublicLogs.mockResolvedValue({ logs: [] })

    expect(watcher["lastBlock"]).toBe(0)

    await (watcher as any).watch()

    expect(watcher["lastBlock"]).toBe(100)
  })
})
