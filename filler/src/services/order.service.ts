import { erc20Abi, padHex, sliceHex } from "viem"
import { AztecAddress, Fr } from "@aztec/aztec.js"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { Mutex } from "async-mutex"
import { waitForTransactionReceipt } from "viem/actions"

import { registerContract } from "../utils/aztec.js"
import { AztecGateway7683Contract } from "../artifacts/AztecGateway7683/AztecGateway7683.js"
import l2Gateway7683Abi from "../abis/l2Gateway7683.js"
import {
  AZTEC_7683_CHAIN_ID,
  ORDER_FILLED,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_INITIATED_PRIVATELY,
  PRIVATE_ORDER_HEX,
} from "../constants.js"
import BaseService from "./base.service.js"
import { hexToUintArray } from "../utils/bytes.js"

import type { Chain, Log } from "viem"
import type { Wallet } from "@aztec/aztec.js"
import type { BaseServiceOpts } from "./base.service.js"
import type MultiClient from "../MultiClient.js"

export type OrderServiceOpts = BaseServiceOpts & {
  aztecWallet: Wallet
  aztecGatewayAddress: `0x${string}`
  evmMultiClient: MultiClient
  l2EvmChain: Chain
  l2EvmGatewayAddress: `0x${string}`
}

class OrderService extends BaseService {
  aztecWallet: Wallet
  aztecGatewayAddress: `0x${string}`
  evmMultiClient: MultiClient
  l2EvmChain: Chain
  l2EvmGatewayAddress: `0x${string}`
  fillEvmOrderFromLogMutex: Mutex
  fillAztecOrderFromLogMutex: Mutex

  constructor(opts: OrderServiceOpts) {
    super(opts)

    this.aztecWallet = opts.aztecWallet
    this.evmMultiClient = opts.evmMultiClient
    this.aztecGatewayAddress = opts.aztecGatewayAddress
    this.l2EvmGatewayAddress = opts.l2EvmGatewayAddress
    this.l2EvmChain = opts.l2EvmChain

    this.fillEvmOrderFromLogMutex = new Mutex()
    this.fillAztecOrderFromLogMutex = new Mutex()

    this.monitorInitiadedPrivatelyOrders()
    setInterval(() => {
      this.monitorInitiadedPrivatelyOrders()
    }, 30000)
  }

  /**
   *
   * @remarks
   * Currently, privately initiated orders are created only on the Aztec network.
   *
   * @returns {Promise<void>} A promise that resolves when monitoring is complete.
   */
  async monitorInitiadedPrivatelyOrders(): Promise<void> {
    try {
      this.logger.info("looking for initiated privately orders ...")

      const orders = await this.db
        .collection("orders")
        .find({
          status: ORDER_STATUS_INITIATED_PRIVATELY,
        })
        .toArray()
      if (orders.length === 0) {
        this.logger.info("no orders initiated privately found ...")
        return
      }

      const gateway = await AztecGateway7683Contract.at(
        AztecAddress.fromString(this.aztecGatewayAddress),
        this.aztecWallet,
      )

      const orderIds = orders.map(({ orderId }) => orderId)
      const newOrdersStatus = await Promise.all(
        orderIds.map((orderId) => gateway.methods.get_order_status(hexToUintArray(orderId)).simulate()),
      )

      const filledOrderIds = orderIds.filter((_, index) => newOrdersStatus[index] === ORDER_FILLED)
      if (filledOrderIds.length === 0) {
        this.logger.info("no orders filled privately found ...")
        return
      }

      this.logger.info(`orders ${filledOrderIds.join(",")} has been filled. updating db ...`)
      await this.db.collection("orders").updateMany(
        {
          orderId: { $in: filledOrderIds },
        },
        { $set: { status: ORDER_STATUS_FILLED } },
      )
    } catch (err) {
      this.logger.error(err)
    }
  }

  async fillAztecOrderFromLog(log: any): Promise<void> {
    const release = await this.fillAztecOrderFromLogMutex.acquire()
    try {
      const {
        orderId,
        resolvedOrder: { fillInstructions, maxSpent, minReceived },
      } = log as any

      this.logger.info(`new order detected on Aztec. order id: ${orderId}. processing it ...`)
      if (await this.db.collection("orders").findOne({ orderId })) {
        this.logger.info(`order ${orderId} already stored in the db. skipping it ...`)
        return
      }

      const l2EvmClient = this.evmMultiClient.getClientByChain(this.l2EvmChain)
      const onChainStatus = await l2EvmClient.readContract({
        abi: l2Gateway7683Abi,
        address: this.l2EvmGatewayAddress,
        functionName: "orderStatus",
        args: [orderId],
      })
      if (onChainStatus !== padHex("0x0")) {
        this.logger.info(`order ${orderId} already processed by someone else. skipping it ...`)
        return
      }

      const originData = fillInstructions[0].originData
      const minReceivedAmount = minReceived[0].amount
      const minReceivedToken = minReceived[0].token
      // const minReceivedRecipient = minReceived[0].recipient
      // const minReceivedChainId = minReceived[0].chainId
      const maxSpentAmount = maxSpent[0].amount
      const maxSpentToken = sliceHex(maxSpent[0].token, 12)
      const maxSpentRecipient = maxSpent[0].recipient
      const maxSpentChainId = maxSpent[0].chainId

      // TODO: check if minReceivedToken is supported
      if (maxSpentChainId !== this.l2EvmChain.id) throw new Error("Invalid chain id")

      // TODO: calculate the best price for this swap
      this.logger.info(
        `swapping from Aztec to ${this.l2EvmChain.name} ${minReceivedAmount} ${minReceivedToken} for ${maxSpentAmount} ${maxSpentToken} to ${maxSpentRecipient}...`,
      )

      // On the EVM chain, there's no distinction since the sender–receiver link is private on Aztec.
      // No claim is required on the EVM side.
      const orderStatus = ORDER_STATUS_FILLED

      this.logger.info(`approving l2EvmGateway to spend ${maxSpentAmount} tokens ...`)
      // @ts-ignore
      let txHash = await l2EvmClient.writeContract({
        abi: erc20Abi,
        //account: l2EvmClient.account.address,
        address: maxSpentToken,
        args: [this.l2EvmGatewayAddress, maxSpentAmount],
        chain: this.l2EvmChain,
        functionName: "approve",
      })
      await waitForTransactionReceipt(l2EvmClient, { hash: txHash })
      this.logger.info(`tokens approved. ${this.l2EvmChain.name}:${txHash}. filling the order ...`)

      const fillerData = this.aztecWallet.getAddress().toString()
      // @ts-ignore
      txHash = await l2EvmClient.writeContract({
        abi: l2Gateway7683Abi,
        // account: l2EvmClient.account.address,
        address: this.l2EvmGatewayAddress,
        args: [orderId, originData, fillerData],
        chain: this.l2EvmChain,
        functionName: "fill",
      })
      await waitForTransactionReceipt(l2EvmClient, { hash: txHash })

      this.logger.info(
        `order ${orderId} filled succesfully. tx hash: ${this.l2EvmChain.name}:${txHash}. storing it ...`,
      )
      await this.addOrder({
        orderId,
        fillerData,
        fillTxHash: txHash,
        log,
        orderStatus,
      })
    } catch (err) {
      this.logger.error(err)
      throw err
    } finally {
      release()
    }
  }

  async fillEvmOrderFromLog(log: Log): Promise<void> {
    const release = await this.fillEvmOrderFromLogMutex.acquire()
    try {
      const {
        args: {
          orderId,
          resolvedOrder: { fillInstructions, maxSpent, minReceived },
        },
      } = log as any

      this.logger.info(`new order detected on ${this.l2EvmChain.name}. order id: ${orderId}. processing it ...`)
      if (await this.db.collection("orders").findOne({ orderId })) {
        this.logger.info(`order ${orderId} already processed. skipping it ...`)
        return
      }

      const originData = fillInstructions[0].originData
      const minReceivedAmount = minReceived[0].amount
      const minReceivedToken = minReceived[0].token
      // const minReceivedRecipient = minReceived[0].recipient
      // const minReceivedChainId = minReceived[0].chainId
      const maxSpentAmount = maxSpent[0].amount
      const maxSpentToken = maxSpent[0].token
      const maxSpentRecipient = maxSpent[0].recipient
      const maxSpentChainId = maxSpent[0].chainId

      // TODO: check if minReceivedToken is supported
      if (maxSpentChainId !== AZTEC_7683_CHAIN_ID) throw new Error("Invalid chain id")

      // TODO: calculate the best price for this swap
      this.logger.info(
        `swapping from ${this.l2EvmChain.name} to Aztec ${minReceivedAmount} ${minReceivedToken} for ${maxSpentAmount} ${maxSpentToken} to ${maxSpentRecipient}...`,
      )

      try {
        this.logger.info("registering token contract into the PXE ...")
        await registerContract(AztecAddress.fromString(maxSpentToken), {
          wallet: this.aztecWallet,
          artifact: TokenContractArtifact,
        })
      } catch (err) {
        this.logger.error(err)
      }

      const [token, aztecGateway] = await Promise.all([
        TokenContract.at(AztecAddress.fromString(maxSpentToken), this.aztecWallet),
        AztecGateway7683Contract.at(AztecAddress.fromString(this.aztecGatewayAddress), this.aztecWallet),
      ])

      const orderType = `0x${originData.slice(538, 540)}`
      const orderStatus = orderType === PRIVATE_ORDER_HEX ? ORDER_STATUS_INITIATED_PRIVATELY : ORDER_STATUS_FILLED

      const fillerData = padHex(this.evmMultiClient.getClientByChain(this.l2EvmChain).account!.address)
      let receipt
      if (orderStatus === ORDER_STATUS_INITIATED_PRIVATELY) {
        this.logger.info(`filling the private order ${orderId} ...`)

        const nonce = `0x${originData.slice(386, 450)}`
        const gatewayAddress = AztecAddress.fromString(this.aztecGatewayAddress)
        const witness = await this.aztecWallet.createAuthWit({
          caller: gatewayAddress,
          action: token
            .withWallet(this.aztecWallet)
            .methods.transfer_in_private(
              this.aztecWallet.getAddress(),
              gatewayAddress,
              maxSpentAmount,
              Fr.fromHexString(nonce),
            ),
        })
        receipt = await aztecGateway
          .withWallet(this.aztecWallet)
          .methods.fill_private(hexToUintArray(orderId), hexToUintArray(originData), hexToUintArray(fillerData))
          .with({
            authWitnesses: [witness],
          })
          .send()
          .wait()
      } else {
        this.logger.info(`setting public authwit to fill the order ${orderId} ...`)
        // @ts-ignore
        const res = await this.aztecWallet.setPublicAuthWit(
          {
            caller: AztecAddress.fromString(this.aztecGatewayAddress),
            action: token.methods.transfer_in_public(
              this.aztecWallet.getAddress(),
              AztecAddress.fromString(this.aztecGatewayAddress),
              maxSpentAmount,
              0,
            ),
          },
          true,
        )
        await res.send().wait()

        this.logger.info(`filling the public order ${orderId} ...`)
        receipt = await aztecGateway
          .withWallet(this.aztecWallet)
          .methods.fill(hexToUintArray(orderId), hexToUintArray(originData), hexToUintArray(fillerData))
          .send()
          .wait()
      }

      this.logger.info(
        `order ${orderId} filled succesfully. tx hash: Aztec:${receipt.txHash.toString()}. storing it ...`,
      )
      await this.addOrder({
        orderId,
        fillerData,
        fillTxHash: receipt.txHash.toString(),
        log: (log as any).args,
        orderStatus,
      })
    } catch (err) {
      this.logger.error(err)
      throw err
    } finally {
      release()
    }
  }

  private async addOrder({
    orderId,
    fillerData,
    fillTxHash,
    orderStatus,
    log,
  }: {
    orderId: `0x${string}`
    fillerData: `0x${string}`
    fillTxHash: `0x${string}`
    orderStatus: "initiatedPrivately" | "filled"
    log: any
  }) {
    return await this.db.collection("orders").findOneAndUpdate(
      { orderId },
      {
        $setOnInsert: {
          ...log,
          fillTxHash: fillTxHash,
          fillerData,
          status: orderStatus,
        },
      },
      { upsert: true, returnDocument: "after" },
    )
  }
}

export default OrderService
