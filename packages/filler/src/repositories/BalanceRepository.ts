import { Db, Collection } from "mongodb"

export interface BalanceDocument {
  chain: string
  asset: string
  address: string
  balance: string
  timestamp: Date
}

export class BalanceRepository {
  private collection: Collection<BalanceDocument>

  constructor(db: Db) {
    this.collection = db.collection<BalanceDocument>("balances")
  }

  async saveBalance(balance: BalanceDocument): Promise<void> {
    await this.collection.insertOne(balance)
  }

  async getLatestBalance(chain: string, asset: string): Promise<BalanceDocument | null> {
    return await this.collection.findOne({ chain, asset }, { sort: { timestamp: -1 } })
  }
}
