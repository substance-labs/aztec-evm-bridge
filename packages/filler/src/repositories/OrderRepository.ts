import { Db, Collection } from "mongodb"

export interface OrderDocument {
  orderId: string
  status: string
  fillTxHash?: string
  fillerData?: string
  [key: string]: any
}

export class OrderRepository {
  private collection: Collection<OrderDocument>

  constructor(db: Db) {
    this.collection = db.collection<OrderDocument>("orders")
  }

  async findByOrderId(orderId: string): Promise<OrderDocument | null> {
    return await this.collection.findOne({ orderId })
  }

  async findByStatus(status: string): Promise<OrderDocument[]> {
    return await this.collection.find({ status }).toArray()
  }

  async updateStatus(orderIds: string[], status: string): Promise<void> {
    await this.collection.updateMany(
      {
        orderId: { $in: orderIds },
      },
      { $set: { status } },
    )
  }

  async addOrder(order: OrderDocument): Promise<void> {
    await this.collection.findOneAndUpdate(
      { orderId: order.orderId },
      {
        $setOnInsert: order,
      },
      { upsert: true, returnDocument: "after" },
    )
  }
}
