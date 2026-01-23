import { describe, it, expect, vi, beforeEach } from "vitest"
import { BalanceRepository } from "../../src/repositories/BalanceRepository.js"
import { Db } from "mongodb"

describe("BalanceRepository", () => {
  let repository: BalanceRepository
  let mockDb: any
  let mockCollection: any

  beforeEach(() => {
    mockCollection = {
      insertOne: vi.fn(),
      findOne: vi.fn(),
    }
    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    }
    repository = new BalanceRepository(mockDb as unknown as Db)
  })

  describe("constructor", () => {
    it("should initialize collection", () => {
      expect(mockDb.collection).toHaveBeenCalledWith("balances")
    })
  })

  describe("saveBalance", () => {
    it("should save balance document", async () => {
      const balance = {
        chain: "ethereum",
        asset: "USDC",
        address: "0x123",
        balance: "1000000",
        timestamp: new Date(),
      }
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true })

      await repository.saveBalance(balance)

      expect(mockCollection.insertOne).toHaveBeenCalledWith(balance)
    })
  })

  describe("getLatestBalance", () => {
    it("should return null if no balance found", async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await repository.getLatestBalance("ethereum", "USDC")

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        { chain: "ethereum", asset: "USDC" },
        { sort: { timestamp: -1 } },
      )
      expect(result).toBeNull()
    })

    it("should return latest balance document", async () => {
      const balance = {
        chain: "ethereum",
        asset: "USDC",
        address: "0x123",
        balance: "1000000",
        timestamp: new Date(),
      }
      mockCollection.findOne.mockResolvedValue(balance)

      const result = await repository.getLatestBalance("ethereum", "USDC")

      expect(result).toEqual(balance)
    })

    it("should sort by timestamp descending to get latest", async () => {
      await repository.getLatestBalance("ethereum", "ETH")

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        { chain: "ethereum", asset: "ETH" },
        { sort: { timestamp: -1 } },
      )
    })
  })
})
