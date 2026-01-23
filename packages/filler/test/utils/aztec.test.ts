import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  parseOpenLog,
  parseResolvedCrossChainOrder,
  getAztecNode,
  getPaymentMethod,
  getSponsoredFPCInstance,
  getSponsoredFPCAddress,
} from "../../src/utils/aztec.js"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { Fr } from "@aztec/aztec.js/fields"

// Mock dependencies
vi.mock("../../src/utils/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@aztec/aztec.js/node", () => ({
  createAztecNodeClient: vi.fn().mockResolvedValue({
    getL1ContractAddresses: vi.fn().mockResolvedValue({}),
    getContract: vi.fn(),
  }),
}))

vi.mock("@aztec/stdlib/contract", () => ({
  getContractInstanceFromInstantiationParams: vi.fn().mockResolvedValue({
    address: "0xFPCAddress",
  }),
}))

vi.mock("@aztec/aztec.js/fee", () => ({
  SponsoredFeePaymentMethod: class {
    constructor(public address: any) {}
  },
}))

describe("Aztec Utils", () => {
  describe("parseOpenLog", () => {
    it("should parse open log correctly", () => {
      // Mock Fr objects
      const mockFr = (val: string) => ({ toString: () => val }) as unknown as Fr

      // Create mock logs
      // log1 needs 13 elements (0-12)
      // log2 needs 11 elements (0-10)
      const log1 = [
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000001"), // orderId
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000002"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000003"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000004"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000005"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000006"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000007"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000008"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000009"),
        mockFr("0x000000000000000000000000000000000000000000000000000000000000000a"),
        mockFr("0x000000000000000000000000000000000000000000000000000000000000000b"),
        mockFr("0x000000000000000000000000000000000000000000000000000000000000000c"),
        mockFr("0x000000000000000000000000000000000000000000000000000000000000000d"), // residualBytes1
      ]

      const log2 = [
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000001"), // orderId
        mockFr("0x000000000000000000000000000000000000000000000000000000000000000e"),
        mockFr("0x000000000000000000000000000000000000000000000000000000000000000f"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000010"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000011"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000012"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000013"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000014"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000015"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000016"),
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000017"), // residualBytes2
      ]

      const result = parseOpenLog(log1, log2)

      expect(result).toHaveProperty("orderId")
      expect(result).toHaveProperty("resolvedOrder")
    })

    it("should throw if orderIds do not match", () => {
      const mockFr = (val: string) => ({ toString: () => val }) as unknown as Fr
      const log1 = [
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000001"),
        ...new Array(11).fill(mockFr("0x0")),
        mockFr("0x0"),
      ]
      const log2 = [
        mockFr("0x0000000000000000000000000000000000000000000000000000000000000002"),
        ...new Array(9).fill(mockFr("0x0")),
        mockFr("0x0"),
      ]

      expect(() => parseOpenLog(log1, log2)).toThrow("logs don't belong to the same order")
    })
  })

  describe("parseResolvedCrossChainOrder", () => {
    it("should parse resolved order string", () => {
      // Create a dummy hex string long enough to be sliced
      // The function slices from the end, up to -1226
      const length = 1300
      const resolvedOrder = "0".repeat(length)

      const result = parseResolvedCrossChainOrder(resolvedOrder)

      expect(result).toHaveProperty("fillInstructions")
      expect(result).toHaveProperty("maxSpent")
      expect(result).toHaveProperty("minReceived")
      expect(result).toHaveProperty("orderId")
    })
  })

  describe("async functions", () => {
    beforeEach(() => {
      vi.clearAllMocks()
      process.env.AZTEC_RPC_URL = "https://next.devnet.aztec-labs.com"
    })

    it("should getAztecNode", async () => {
      const node = await getAztecNode()
      expect(node).toBeDefined()
      expect(createAztecNodeClient).toHaveBeenCalledWith("https://next.devnet.aztec-labs.com")
    })

    it("should getAztecNode with default URL", async () => {
      delete process.env.AZTEC_RPC_URL
      const node = await getAztecNode()
      expect(node).toBeDefined()
      expect(createAztecNodeClient).toHaveBeenCalledWith("https://next.devnet.aztec-labs.com")
    })

    it("should getSponsoredFPCInstance", async () => {
      const instance = await getSponsoredFPCInstance()
      expect(instance).toEqual({ address: "0xFPCAddress" })
    })

    it("should getSponsoredFPCAddress", async () => {
      const address = await getSponsoredFPCAddress()
      expect(address).toBe("0xFPCAddress")
    })

    it("should getPaymentMethod", async () => {
      const pm = await getPaymentMethod()
      expect(pm).toBeDefined()
    })
  })
})
