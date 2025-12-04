import BaseService from "./base.service.js"

interface BlockCursor {
  _id: string
  lastBlock: number
}

class BlockService extends BaseService {
  private collectionName = "block_cursors"

  async getLastBlock(watcherName: string): Promise<number | null> {
    const result = await this.db.collection<BlockCursor>(this.collectionName).findOne({ _id: watcherName })
    return result ? result.lastBlock : null
  }

  async setLastBlock(watcherName: string, blockNumber: number): Promise<void> {
    await this.db
      .collection<BlockCursor>(this.collectionName)
      .updateOne({ _id: watcherName }, { $set: { lastBlock: blockNumber } }, { upsert: true })
  }
}

export default BlockService
