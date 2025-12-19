import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { Mutex } from "async-mutex"
import type { Log } from "viem"

import { AztecGateway7683Contract } from "../artifacts/AztecGateway7683/AztecGateway7683.js"
import { ORDER_FILLED, ORDER_STATUS_FILLED, ORDER_STATUS_FILLED_PRIVATELY } from "../constants.js"
import BaseService from "./base.service.js"
import { OrderRepository } from "../repositories/OrderRepository.js"
import { fillOrderOnEvm } from "../operations/EvmOrderFiller.js"
import { fillOrderOnAztec } from "../operations/AztecOrderFiller.js"
import type { BaseServiceOpts } from "./base.service.js"
import type MultiClient from "../MultiClient.js"
import type { ResolvedOrder } from "../types.js"
import { ChainConfigType, config, getChainConfig } from "../config.js"
import type { EmbeddedWallet } from "../wallet/EmbeddedWallet.js"

export type OrderServiceOpts = BaseServiceOpts & {
  aztecWallet: EmbeddedWallet
  evmMultiClient: MultiClient
}

class OrderService extends BaseService {
  aztecWallet: EmbeddedWallet
  aztecGatewayAddress: `0x${string}`
  evmMultiClient: MultiClient
  fillEvmOrderFromLogMutex: Mutex
  fillAztecOrderFromLogMutex: Mutex
  orderRepository: OrderRepository

  constructor(opts: OrderServiceOpts) {
    super(opts)

    this.aztecWallet = opts.aztecWallet
    this.aztecGatewayAddress = config.chains.aztec.gateway
    this.evmMultiClient = opts.evmMultiClient
    this.fillEvmOrderFromLogMutex = new Mutex()
    this.fillAztecOrderFromLogMutex = new Mutex()
    this.orderRepository = new OrderRepository(this.db)

    this.logger.info("OrderService started")

    this.monitorFilledPrivatelyOrders()
    setInterval(() => {
      this.monitorFilledPrivatelyOrders()
    }, 180000)
  }

  async monitorFilledPrivatelyOrders(): Promise<void> {
    try {
      this.logger.info("looking for initiated privately orders ...")

      const orders = await this.orderRepository.findByStatus(ORDER_STATUS_FILLED_PRIVATELY)
      if (orders.length === 0) {
        this.logger.info("no orders initiated privately found ...")
        return
      }

      const gateway = await AztecGateway7683Contract.at(
        AztecAddress.fromString(this.aztecGatewayAddress),
        this.aztecWallet,
      )

      const orderIds = orders.map(({ orderId }) => orderId)
      const newOrdersStatus: bigint[] = []
      for (const orderId of orderIds) {
        newOrdersStatus.push(
          (await gateway.methods
            .get_order_status(Fr.fromHexString(orderId))
            .simulate({ from: this.aztecWallet.getAddress() })) as bigint,
        )
      }

      const filledOrderIds = orderIds.filter((_, index) => newOrdersStatus[index] === ORDER_FILLED)
      if (filledOrderIds.length === 0) {
        this.logger.info("no orders filled privately found ...")
        return
      }

      this.logger.info(`Orders ${filledOrderIds.join(",")} has been filled. Updating db ...`)
      await this.orderRepository.updateStatus(filledOrderIds, ORDER_STATUS_FILLED)
    } catch (err) {
      this.logger.error(err)
    }
  }

  async fillOrderFromAztecLog(log: ResolvedOrder, destinationChainName: string): Promise<void> {
    const release = await this.fillAztecOrderFromLogMutex.acquire()
    try {
      const { orderId } = log

      this.logger.info(`New order detected on Aztec. order id: ${orderId}. processing it ...`)
      if (await this.orderRepository.findByOrderId(orderId)) {
        this.logger.info(`Order ${orderId} already stored in the db. skipping it ...`)
        return
      }

      switch (getChainConfig(destinationChainName)?.type) {
        case ChainConfigType.AZTEC:
          this.logger.warn(`Aztec to Aztec orders are not supported. Skipping order ${orderId} ...`)
          return
        case ChainConfigType.EVM:
          const result = await fillOrderOnEvm(
            log,
            destinationChainName,
            this.aztecGatewayAddress,
            this.evmMultiClient,
            this.logger,
          )
          if (result) {
            await this.orderRepository.addOrder({
              fillerData: result.fillerData,
              fillTxHash: result.txHash,
              status: result.orderStatus,
              ...log,
            })
          }
          return
        default:
          this.logger.error(`Unknown destination chain type for order ${orderId}. Skipping it ...`)
      }
    } catch (err) {
      this.logger.error(err)
    } finally {
      release()
    }
  }

  async fillOrderFromEvmLog(log: Log, destinationChainName: string): Promise<void> {
    const release = await this.fillEvmOrderFromLogMutex.acquire()
    try {
      const {
        args: { orderId },
      } = log as any

      this.logger.info(`New order detected on /*this.l2EvmChain.name*/}. order id: ${orderId}. processing it ...`) // Move to the watcher
      if (await this.orderRepository.findByOrderId(orderId)) {
        this.logger.info(`order ${orderId} already processed. skipping it ...`)
        return
      }

      switch (getChainConfig(destinationChainName)?.type) {
        case "aztec":
          const result = await fillOrderOnAztec(log, this.aztecWallet, this.evmMultiClient, this.logger)
          if (result) {
            await this.orderRepository.addOrder({
              fillerData: result.fillerData,
              fillTxHash: result.txHash,
              status: result.orderStatus,
              ...result.logArgs,
            })
          }
          return
        case "evm":
          this.logger.warn(`Evm to Evm orders are not supported. Skipping order ${orderId} ...`)
          return
        default:
          this.logger.error(`Unknown destination chain type for order ${orderId}. Skipping it ...`)
      }
    } catch (err) {
      this.logger.error("Error occurred while filling order:")
      this.logger.error(err)
    } finally {
      release()
    }
  }
}

export default OrderService
