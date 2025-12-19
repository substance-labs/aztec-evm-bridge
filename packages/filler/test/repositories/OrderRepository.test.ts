import { describe, it, expect, vi, beforeEach } from "vitest"
import { OrderRepository } from "../../src/repositories/OrderRepository.js"
import { Db, Collection } from "mongodb"

describe("OrderRepository", () => {
  let repository: OrderRepository
  let mockDb: any
  let mockCollection: any

  beforeEach(() => {
    mockCollection = {
      findOne: vi.fn(),
      find: vi.fn(),
      updateMany: vi.fn(),
      findOneAndUpdate: vi.fn(),
    }
    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    }
    repository = new OrderRepository(mockDb as unknown as Db)
  })

  describe("constructor", () => {
    it("should initialize collection", () => {
      expect(mockDb.collection).toHaveBeenCalledWith("orders")
    })
  })

  describe("findByOrderId", () => {
    it("should find order by id", async () => {
      const mockOrder = { orderId: "123", status: "pending" }
      mockCollection.findOne.mockResolvedValue(mockOrder)

      const result = await repository.findByOrderId("123")

      expect(mockCollection.findOne).toHaveBeenCalledWith({ orderId: "123" })
      expect(result).toEqual(mockOrder)
    })

    it("should return null if order not found", async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await repository.findByOrderId("123")

      expect(result).toBeNull()
    })
  })

  describe("findByStatus", () => {
    it("should find orders by status", async () => {
      const mockOrders = [{ orderId: "123", status: "pending" }]
      const mockCursor = {
        toArray: vi.fn().mockResolvedValue(mockOrders),
      }
      mockCollection.find.mockReturnValue(mockCursor)

      const result = await repository.findByStatus("pending")

      expect(mockCollection.find).toHaveBeenCalledWith({ status: "pending" })
      expect(mockCursor.toArray).toHaveBeenCalled()
      expect(result).toEqual(mockOrders)
    })
  })

  describe("updateStatus", () => {
    it("should update status for multiple orders", async () => {
      const orderIds = ["123", "456"]
      const status = "completed"

      await repository.updateStatus(orderIds, status)

      expect(mockCollection.updateMany).toHaveBeenCalledWith(
        {
          orderId: { $in: orderIds },
        },
        { $set: { status } },
      )
    })
  })

  describe("addOrder", () => {
    it("should add order if not exists", async () => {
      const order = { orderId: "123", status: "pending" }

      await repository.addOrder(order)

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { orderId: "123" },
        { $setOnInsert: order },
        { upsert: true, returnDocument: "after" },
      )
    })
  })
})
