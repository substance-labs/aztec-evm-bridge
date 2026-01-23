import { Db, Collection } from "mongodb"

export interface ChainStateDocument {
  chainId: string
  lastProcessedBlock: bigint
  updatedAt: Date
}

interface ChainStateDbDocument {
  chainId: string
  lastProcessedBlock: string // stored as string since MongoDB doesn't support bigint
  updatedAt: Date
}

export class ChainStateRepository {
  private collection: Collection<ChainStateDbDocument>

  constructor(db: Db) {
    this.collection = db.collection<ChainStateDbDocument>("chainState")
  }

  async getLastProcessedBlock(chainId: string): Promise<bigint | null> {
    const doc = await this.collection.findOne({ chainId })
    if (!doc) {
      return null
    }
    return BigInt(doc.lastProcessedBlock)
  }

  async setLastProcessedBlock(chainId: string, blockNumber: bigint): Promise<void> {
    await this.collection.updateOne(
      { chainId },
      {
        $set: {
          lastProcessedBlock: blockNumber.toString(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    )
  }
}
