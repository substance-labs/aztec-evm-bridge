import { sha256ToField } from "@aztec/foundation/crypto"
import { AztecAddress, Fr } from "@aztec/aztec.js"
import { bytesToHex, encodeAbiParameters, keccak256, padHex } from "viem"
import { waitForTransactionReceipt } from "viem/actions"
const { ssz } = await import("@lodestar/types")
const { BeaconBlock, SignedBeaconBlock } = ssz.electra
const { createProof, ProofType } = await import("@chainsafe/persistent-merkle-tree")
import { Mutex } from "async-mutex"

import BaseService from "./base.service"
import {
  AZTEC_7683_CHAIN_ID,
  AZTEC_VERSION,
  FORWARDER_CHAIN_ID,
  FORWARDER_SETTLE_ORDER_SLOTS,
  L2_GATEWAY_FILLED_ORDERS_SLOT,
  OP_STACK_ANCHOR_REGISTRY_OP_SEPOLIA,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_SETTLE_FORWARDED,
  ORDER_STATUS_SETTLED,
  PORTAL_ADDRESS,
  SETTLE_ORDER_TYPE,
} from "../constants"
import forwarderAbi from "../abis/forwarder"
import l2Gateway7683Abi from "../abis/l2Gateway7683"
import anchorRegistryAbi from "../abis/anchorRegistry"
import { AztecGateway7683Contract } from "../artifacts/AztecGateway7683/AztecGateway7683"
import { hexToUintArray } from "../utils/bytes"

import type { Chain } from "viem"
import type { AztecNode, PXE, Wallet } from "@aztec/aztec.js"
import type { BaseServiceOpts } from "./base.service"
import type { Order } from "../types"
import type MultiClient from "../MultiClient"

export type SettlementServiceOpts = BaseServiceOpts & {
  aztecWallet: Wallet
  aztecGatewayAddress: `0x${string}`
  aztecNode: AztecNode
  beaconApiUrl: string
  evmMultiClient: MultiClient
  forwarderAddress: `0x${string}`
  l1Chain: Chain
  l2EvmChain: Chain
  l2EvmGatewayAddress: `0x${string}`
  pxe: PXE
}

const getExecutionStateRootProof = (block: any): { proof: string[]; leaf: string } => {
  const blockView = BeaconBlock.toView(block)
  const path = ["body", "executionPayload", "stateRoot"]
  const pathInfo = blockView.type.getPathInfo(path)
  const proofObj = createProof(blockView.node, {
    type: ProofType.single,
    gindex: pathInfo.gindex,
  }) as any
  const proof = proofObj.witnesses.map((w: Uint8Array) => bytesToHex(w))
  const leaf = bytesToHex(proofObj.leaf as Uint8Array)
  return { proof, leaf }
}

class SettlementService extends BaseService {
  aztecWallet: Wallet
  aztecGatewayAddress: `0x${string}`
  aztecNode: AztecNode
  beaconApiUrl: string
  evmMultiClient: MultiClient
  forwarderAddress: `0x${string}`
  l1Chain: Chain
  l2EvmChain: Chain
  l2EvmGatewayAddress: `0x${string}`
  pxe: PXE
  forwardOrderSettlementMutex: Mutex
  settleOrderMutex: Mutex

  constructor(opts: SettlementServiceOpts) {
    super(opts)

    this.aztecWallet = opts.aztecWallet
    this.evmMultiClient = opts.evmMultiClient
    this.aztecGatewayAddress = opts.aztecGatewayAddress
    this.forwarderAddress = opts.forwarderAddress
    this.pxe = opts.pxe
    this.aztecNode = opts.aztecNode
    this.l1Chain = opts.l1Chain
    this.l2EvmChain = opts.l2EvmChain
    this.l2EvmGatewayAddress = opts.l2EvmGatewayAddress
    this.beaconApiUrl = opts.beaconApiUrl

    this.forwardOrderSettlementMutex = new Mutex()
    this.settleOrderMutex = new Mutex()

    this.forwardOrderSettlements()
    setInterval(() => {
      this.forwardOrderSettlements()
    }, 30000)

    this.settleOrders()
    setInterval(() => {
      this.settleOrders()
    }, 30000)
  }

  async forwardOrderSettlements() {
    try {
      this.logger.info("looking for forwarding order settlements ....")
      const orders = await this.db
        .collection("orders")
        .find({
          status: ORDER_STATUS_FILLED,
        })
        .toArray()
      for (const order of orders) {
        try {
          if (order.resolvedOrder.maxSpent[0].chainId === this.l2EvmChain.id) {
            await this.forwardOrderSettlementToAztec({
              orderId: order.orderId,
              resolvedOrder: order.resolvedOrder,
              fillTxHash: order.fillTxHash,
              fillerData: order.fillerData,
              status: order.status,
            })
          } else if (order.resolvedOrder.maxSpent[0].chainId === AZTEC_7683_CHAIN_ID) {
            await this.forwardOrderSettlementToEvmL2({
              orderId: order.orderId,
              resolvedOrder: order.resolvedOrder,
              fillTxHash: order.fillTxHash,
              fillerData: order.fillerData,
              status: order.status,
            })
          }
        } catch (err) {}
      }
    } catch (err) {
      this.logger.error(err)
    }
  }

  async forwardOrderSettlementToAztec(order: Order) {
    const release = await this.forwardOrderSettlementMutex.acquire()
    try {
      this.logger.info(`forwarding settlement to Aztec for order ${order.orderId} ...`)

      // NOTE: At the moment we support only Optimism Sepolia

      const l2EvmClient = this.evmMultiClient.getClientByChain(this.l2EvmChain)
      const l1client = this.evmMultiClient.getClientByChain(this.l1Chain)

      const [_, l2EvmblockNumber] = (await l1client.readContract({
        abi: anchorRegistryAbi,
        functionName: "getAnchorRoot",
        args: [],
        address: OP_STACK_ANCHOR_REGISTRY_OP_SEPOLIA,
      })) as [`0x${string}`, bigint]

      const storageKey = keccak256(
        encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [order.orderId, L2_GATEWAY_FILLED_ORDERS_SLOT]),
      )

      const proof = await l2EvmClient.request({
        method: "eth_getProof",
        params: [this.l2EvmGatewayAddress, [storageKey], `0x${l2EvmblockNumber.toString(16)}`],
      })

      const accountProofParameters = {
        storageKey: proof.storageProof[0]!.key,
        storageValue: proof.storageProof[0]!.value,
        accountProof: proof.accountProof,
        storageProof: proof.storageProof[0]!.proof,
      }
      if (accountProofParameters.storageProof.length === 0) {
        this.logger.info(`anchor root not updated yet. skipping for now ...`)
        return
      }

      // @ts-ignore
      const forwardSettleTxHash = await l1client.writeContract({
        abi: forwarderAbi,
        // account: l1client.account.address,
        address: this.forwarderAddress,
        args: [
          order.orderId,
          order.resolvedOrder.fillInstructions[0]!.originData,
          order.fillerData!,
          accountProofParameters,
        ],
        chain: this.l1Chain,
        functionName: "forwardSettleToAztec",
      })
      this.logger.info(
        `waiting for forwardSettleToAztec transaction confirmation of ${forwardSettleTxHash} for order ${order.orderId} ...`,
      )
      await waitForTransactionReceipt(l1client, { hash: forwardSettleTxHash })

      this.logger.info(
        `settlement succesfully forwarded to Aztec for order ${order.orderId}. tx hash: ${forwardSettleTxHash}`,
      )
      await this.db.collection("orders").findOneAndUpdate(
        { orderId: order.orderId },
        {
          $set: {
            forwardSettleTxHash,
            status: ORDER_STATUS_SETTLE_FORWARDED,
          },
        },
        { upsert: true, returnDocument: "after" },
      )
    } catch (err) {
      this.logger.error(err)
      throw err
    } finally {
      release()
    }
  }

  async forwardOrderSettlementToEvmL2(order: Order) {
    const release = await this.forwardOrderSettlementMutex.acquire()
    try {
      this.logger.info(`forwarding settlement to L2 for order ${order.orderId} ...`)

      const message = [
        Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
        Buffer.from(order.orderId.slice(2), "hex"),
        Buffer.from(order.fillerData!.slice(2), "hex"),
      ]
      const messageHash = sha256ToField(message)

      const l2ToL1Message = sha256ToField([
        Buffer.from(this.aztecGatewayAddress.slice(2), "hex"),
        new Fr(AZTEC_VERSION).toBuffer(),
        PORTAL_ADDRESS.toBuffer32(),
        new Fr(FORWARDER_CHAIN_ID).toBuffer(),
        messageHash.toBuffer(),
      ])

      const gateway = await AztecGateway7683Contract.at(
        AztecAddress.fromString(this.aztecGatewayAddress),
        this.aztecWallet,
      )
      const orderSettlementBlockNumber = await gateway.methods
        .get_order_settlement_block_number(hexToUintArray(order.orderId))
        .simulate()

      const [l2ToL1MessageIndex, siblingPath] = await this.pxe.getL2ToL1MembershipWitness(
        parseInt(orderSettlementBlockNumber),
        l2ToL1Message,
      )

      const l1client = this.evmMultiClient.getClientByChain(this.l1Chain)
      // @ts-ignore
      const forwardSettleTxHash = await l1client.writeContract({
        abi: forwarderAbi,
        // account: l1client.account.address,
        address: this.forwarderAddress,
        args: [
          [
            [this.aztecGatewayAddress, AZTEC_VERSION],
            [this.forwarderAddress, FORWARDER_CHAIN_ID],
            messageHash.toString(),
          ],
          bytesToHex(Buffer.concat([...message])),
          orderSettlementBlockNumber,
          l2ToL1MessageIndex,
          [padHex("0x00")],
        ],
        chain: this.l1Chain,
        functionName: "forwardSettleToL2",
      })
      this.logger.info(
        `waiting for forwardSettleToL2 transaction confirmation of ${forwardSettleTxHash} for order ${order.orderId} ...`,
      )
      await waitForTransactionReceipt(l1client, { hash: forwardSettleTxHash })

      this.logger.info(
        `settlement succesfully forwarded to L2 for order ${order.orderId}. tx hash: ${forwardSettleTxHash}`,
      )
      await this.db.collection("orders").findOneAndUpdate(
        { orderId: order.orderId },
        {
          $set: {
            forwardSettleTxHash,
            status: ORDER_STATUS_SETTLE_FORWARDED,
          },
        },
        { upsert: true, returnDocument: "after" },
      )
    } catch (err) {
      this.logger.error(err)
      throw err
    } finally {
      release()
    }
  }

  async settleOrders() {
    try {
      this.logger.info("looking for settlable orders ....")
      const orders = await this.db
        .collection("orders")
        .find({
          status: ORDER_STATUS_SETTLE_FORWARDED,
        })
        .toArray()

      for (const order of orders) {
        try {
          if (order.resolvedOrder.maxSpent[0].chainId === this.l2EvmChain.id) {
            await this.settleOrderOnAztec({
              orderId: order.orderId,
              resolvedOrder: order.resolvedOrder,
              fillTxHash: order.fillTxHash,
              fillerData: order.fillerData,
              status: order.status,
            })
          } else if (order.resolvedOrder.maxSpent[0].chainId === AZTEC_7683_CHAIN_ID) {
            await this.settleOrderOnEvmL2({
              orderId: order.orderId,
              resolvedOrder: order.resolvedOrder,
              fillTxHash: order.fillTxHash,
              fillerData: order.fillerData,
              status: order.status,
            })
          }
        } catch (err) {}
      }
    } catch (err) {
      this.logger.error(err)
    }
  }

  async settleOrderOnAztec(order: Order) {
    try {
      this.logger.info(`settling order ${order.orderId} on Aztec ...`)
      // TODO
    } catch (err) {
      this.logger.error(err)
      throw err
    } finally {
    }
  }

  async settleOrderOnEvmL2(order: Order) {
    const release = await this.settleOrderMutex.acquire()
    try {
      this.logger.info(`settling order ${order.orderId} on L2 ...`)

      const l1Client = this.evmMultiClient.getClientByChain(this.l1Chain)
      const l2EvmClient = this.evmMultiClient.getClientByChain(this.l2EvmChain)

      const message = [
        Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
        Buffer.from(order.orderId.slice(2), "hex"),
        Buffer.from(order.fillerData!.slice(2), "hex"),
      ]
      const messageHash = sha256ToField(message)

      const { parentBeaconBlockRoot: beaconRoot, timestamp: beaconOracleTimestamp } = await l2EvmClient.getBlock()
      const resp = await fetch(`${this.beaconApiUrl}/eth/v2/beacon/blocks/${beaconRoot}`, {
        headers: { Accept: "application/octet-stream" },
      })
      const beaconBlock = SignedBeaconBlock.deserialize(new Uint8Array(await resp.arrayBuffer())).message
      const l1BlockNumber = BigInt(beaconBlock.body.executionPayload.blockNumber)

      const stateRootInclusionProof = getExecutionStateRootProof(beaconBlock)
      const storageKey = keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }],
          [messageHash.toString(), FORWARDER_SETTLE_ORDER_SLOTS],
        ),
      )
      const proof = await l1Client.getProof({
        address: this.forwarderAddress,
        storageKeys: [storageKey],
        blockNumber: l1BlockNumber,
      })

      const stateRootParameters = {
        beaconRoot,
        beaconOracleTimestamp,
        executionStateRoot: stateRootInclusionProof.leaf,
        stateRootProof: stateRootInclusionProof.proof,
      }

      const accountProofParameters = {
        storageKey: proof.storageProof[0]!.key,
        storageValue: proof.storageProof[0]!.value === 1n ? "0x01" : "0x00",
        accountProof: proof.accountProof,
        storageProof: proof.storageProof[0]!.proof,
      }

      if (accountProofParameters.storageValue === "0x00") {
        this.logger.info(`storage value not up to date yet for order ${order.orderId}. trying in seconds ...`)
        return
      }

      // @ts-ignore
      const settleTxHash = await l2EvmClient.writeContract({
        // account: l2EvmClient.account.address,
        address: this.l2EvmGatewayAddress,
        chain: this.l2EvmChain,
        functionName: "settle",
        args: [bytesToHex(Buffer.concat([...message])), stateRootParameters, accountProofParameters],
        abi: l2Gateway7683Abi,
      })
      this.logger.info(`waiting for transaction confirmation of ${settleTxHash} ...`)
      await waitForTransactionReceipt(l2EvmClient, { hash: settleTxHash })

      this.logger.info(`order ${order.orderId} succesfully settled. tx hash: ${settleTxHash}`)
      await this.db.collection("orders").findOneAndUpdate(
        { orderId: order.orderId },
        {
          $set: {
            settleTxHash,
            status: ORDER_STATUS_SETTLED,
          },
        },
        { upsert: true, returnDocument: "after" },
      )
    } catch (err) {
      this.logger.error(err)
      throw err
    } finally {
      release()
    }
  }
}

export default SettlementService
