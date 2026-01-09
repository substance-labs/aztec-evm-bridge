import { describe, it, expect, vi, beforeEach } from "vitest"
import { ChainStateRepository } from "../../src/repositories/ChainStateRepository.js"
import { Db } from "mongodb"

describe("ChainStateRepository", () => {
  let repository: ChainStateRepository
  let mockDb: any
  let mockCollection: any

  beforeEach(() => {
    mockCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn(),
    }
    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    }
    repository = new ChainStateRepository(mockDb as unknown as Db)
  })

  describe("constructor", () => {
    it("should initialize collection", () => {
      expect(mockDb.collection).toHaveBeenCalledWith("chainState")
    })
  })

  describe("getLastProcessedBlock", () => {
    it("should return null if no document found", async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await repository.getLastProcessedBlock("chain-1")

      expect(mockCollection.findOne).toHaveBeenCalledWith({ chainId: "chain-1" })
      expect(result).toBeNull()
    })

    it("should return bigint block number if document found", async () => {
      mockCollection.findOne.mockResolvedValue({
        chainId: "chain-1",
        lastProcessedBlock: "12345",
        updatedAt: new Date(),
      })

      const result = await repository.getLastProcessedBlock("chain-1")

      expect(result).toBe(12345n)
    })

    it("should handle large block numbers correctly", async () => {
      const largeBlockNumber = "999999999999999999"
      mockCollection.findOne.mockResolvedValue({
        chainId: "chain-1",
        lastProcessedBlock: largeBlockNumber,
        updatedAt: new Date(),
      })

      const result = await repository.getLastProcessedBlock("chain-1")

      expect(result).toBe(BigInt(largeBlockNumber))
    })
  })

  describe("setLastProcessedBlock", () => {
    it("should update or insert document with block number as string", async () => {
      const blockNumber = 12345n
      mockCollection.updateOne.mockResolvedValue({ acknowledged: true })

      await repository.setLastProcessedBlock("chain-1", blockNumber)

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { chainId: "chain-1" },
        {
          $set: {
            lastProcessedBlock: "12345",
            updatedAt: expect.any(Date),
          },
        },
        { upsert: true },
      )
    })

    it("should handle large block numbers", async () => {
      const largeBlockNumber = 999999999999999999n
      mockCollection.updateOne.mockResolvedValue({ acknowledged: true })

      await repository.setLastProcessedBlock("chain-1", largeBlockNumber)

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { chainId: "chain-1" },
        {
          $set: {
            lastProcessedBlock: "999999999999999999",
            updatedAt: expect.any(Date),
          },
        },
        { upsert: true },
      )
    })

    it("should update existing document", async () => {
      mockCollection.updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1 })

      await repository.setLastProcessedBlock("chain-1", 100n)
      await repository.setLastProcessedBlock("chain-1", 200n)

      expect(mockCollection.updateOne).toHaveBeenCalledTimes(2)
      expect(mockCollection.updateOne).toHaveBeenLastCalledWith(
        { chainId: "chain-1" },
        {
          $set: {
            lastProcessedBlock: "200",
            updatedAt: expect.any(Date),
          },
        },
        { upsert: true },
      )
    })
  })
})
