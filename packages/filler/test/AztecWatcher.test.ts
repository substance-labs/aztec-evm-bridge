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
    const watchSpy = vi.spyOn(watcher as any, "watch").mockResolvedValue(undefined)

    await watcher.start()

    expect(watchSpy).toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(watchSpy).toHaveBeenCalledTimes(2)
  })

  it("should initialize lastBlock on first watch", async () => {
    mockNode.getBlockNumber.mockResolvedValue(100)

    // Ensure lastBlock is 0 initially
    expect(watcher["lastBlock"]).toBe(0)

    await (watcher as any).watch()

    // It should set lastBlock to currentBlock - 1 initially, then update to currentBlock
    // But inside watch:
    // if (!this.lastBlock) this.lastBlock = currentBlock - 1 (99)
    // fromBlock = 100
    // toBlock = 101
    // this.lastBlock = currentBlock (100)

    expect(watcher["lastBlock"]).toBe(100)
    expect(mockNode.getPublicLogs).toHaveBeenCalled()
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
  })

  it("should handle errors gracefully", async () => {
    mockNode.getBlockNumber.mockRejectedValue(new Error("Network error"))

    await (watcher as any).watch()

    expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error))
  })
})
