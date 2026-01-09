import { sha256ToField } from "@aztec/foundation/crypto/sha256"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { EthAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { bytesToHex, encodeAbiParameters, keccak256 } from "viem"
import { waitForTransactionReceipt } from "viem/actions"
const { ssz } = await import("@lodestar/types")
const { createProof, ProofType } = await import("@chainsafe/persistent-merkle-tree")
import { Mutex } from "async-mutex"
import { computeL2ToL1MembershipWitness } from "@aztec/stdlib/messaging"
import { computeL2ToL1MessageHash } from "@aztec/stdlib/hash"
import type { Chain } from "viem"

import BaseService from "./base.service.js"
import {
  AZTEC_7683_CHAIN_ID,
  AZTEC_VERSION,
  FORWARDER_CHAIN_ID,
  FORWARDER_SETTLE_ORDER_SLOT,
  L2_GATEWAY_FILLED_ORDERS_SLOT,
  OP_STACK_ANCHOR_REGISTRY_ADDRESS,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_SETTLE_FORWARDED,
  ORDER_STATUS_SETTLED,
  FORWARDER_ADDRESS,
  SETTLE_ORDER_TYPE,
  AZTEC_ROLLUP_CONTRACT_L1_ADDRESS,
  IS_SANDBOX_ENV,
} from "../constants.js"
import forwarderAbi from "../abis/forwarder.js"
import l2Gateway7683Abi from "../abis/l2Gateway7683.js"
import anchorRegistryAbi from "../abis/anchorRegistry.js"
import rollupAbi from "../abis/rollup.js"
import { AztecGateway7683Contract } from "../artifacts/AztecGateway7683/AztecGateway7683.js"
import type { BaseServiceOpts } from "./base.service.js"
import type { Order } from "../types.js"
import type MultiClient from "../MultiClient.js"
import type { EmbeddedWallet } from "../wallet/EmbeddedWallet.js"
import { BlockNumber } from "@aztec/foundation/branded-types"

const { BeaconBlock } = ssz.fulu

export type SettlementServiceOpts = BaseServiceOpts & {
  aztecWallet: EmbeddedWallet
  aztecGatewayAddress: `0x${string}`
  beaconApiUrl: string
  evmMultiClient: MultiClient
  forwarderAddress: `0x${string}`
  l1Chain: Chain
  l2EvmChain: Chain
  l2EvmGatewayAddress: `0x${string}`
}

const getExecutionStateRootProof = (block: any): { proof: string[]; leaf: string } => {
  // Convert JSON beacon block to SSZ format for Merkle proof generation
  const sszBlock = BeaconBlock.fromJson(block)
  const blockView = BeaconBlock.toView(sszBlock)
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
  aztecWallet: EmbeddedWallet
  aztecGatewayAddress: `0x${string}`
  beaconApiUrl: string
  evmMultiClient: MultiClient
  forwarderAddress: `0x${string}`
  l1Chain: Chain
  l2EvmChain: Chain
  l2EvmGatewayAddress: `0x${string}`
  forwardOrderSettlementMutex: Mutex
  settleOrderMutex: Mutex

  constructor(opts: SettlementServiceOpts) {
    super(opts)

    this.aztecWallet = opts.aztecWallet
    this.evmMultiClient = opts.evmMultiClient
    this.aztecGatewayAddress = opts.aztecGatewayAddress
    this.forwarderAddress = opts.forwarderAddress
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
          } else if (order.resolvedOrder.maxSpent[0].chainId === Number(AZTEC_7683_CHAIN_ID)) {
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

      // NOTE: At the moment we support only Base Sepolia

      const { publicClient: l2EvmPublicClient } = this.evmMultiClient.getClientByChain(this.l2EvmChain)
      const { publicClient: l1PublicClient, walletClient: l1WalletClient } = this.evmMultiClient.getClientByChain(
        this.l1Chain,
      )

      const [_, l2EvmAnchorRootblockNumber] = (await l1PublicClient.readContract({
        abi: anchorRegistryAbi,
        functionName: "getAnchorRoot",
        args: [],
        address: OP_STACK_ANCHOR_REGISTRY_ADDRESS,
      })) as [`0x${string}`, bigint]

      const receipt = await l2EvmPublicClient.getTransactionReceipt({ hash: order.fillTxHash as `0x${string}` })
      if (receipt.blockNumber > l2EvmAnchorRootblockNumber) {
        this.logger.info(
          `cannot forward settlement to Aztec for order ${order.orderId} because the corresponding block number ${receipt.blockNumber} is > than the anchor root one ${l2EvmAnchorRootblockNumber} ...`,
        )
        return
      }

      const storageKey = keccak256(
        encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [order.orderId, L2_GATEWAY_FILLED_ORDERS_SLOT]),
      )

      const proof = await l2EvmPublicClient.request({
        method: "eth_getProof",
        params: [this.l2EvmGatewayAddress, [storageKey], `0x${l2EvmAnchorRootblockNumber.toString(16)}`],
      })

      const accountProofParameters = {
        storageKey: proof.storageProof[0]!.key,
        storageValue: proof.storageProof[0]!.value,
        accountProof: proof.accountProof,
        storageProof: proof.storageProof[0]!.proof,
      }

      // @ts-ignore
      const forwardSettleTxHash = await l1WalletClient.writeContract({
        abi: forwarderAbi,
        // account: l1Client.account.address,
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
      await waitForTransactionReceipt(l1PublicClient, { hash: forwardSettleTxHash })

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
    } finally {
      release()
    }
  }

  async forwardOrderSettlementToEvmL2(order: Order) {
    const release = await this.forwardOrderSettlementMutex.acquire()
    try {
      this.logger.info(`forwarding settlement to L2 for order ${order.orderId} ...`)

      const gateway = await AztecGateway7683Contract.at(
        AztecAddress.fromString(this.aztecGatewayAddress),
        this.aztecWallet,
      )

      const message = [
        Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
        Buffer.from(order.orderId.slice(2), "hex"),
        Buffer.from(order.fillerData!.slice(2), "hex"),
      ]
      const messageHash = sha256ToField(message)

      const l2ToL1Message = computeL2ToL1MessageHash({
        l2Sender: AztecAddress.fromString(this.aztecGatewayAddress),
        l1Recipient: EthAddress.fromString(FORWARDER_ADDRESS),
        content: messageHash,
        rollupVersion: new Fr(AZTEC_VERSION),
        chainId: new Fr(FORWARDER_CHAIN_ID),
      })

      const orderSettlementBlockNumber = (await gateway.methods
        .get_order_settlement_block_number(Fr.fromBufferReduce(Buffer.from(order.orderId.slice(2), "hex")))
        .simulate({ from: this.aztecWallet.getAddress() })) as bigint

      const l1Client = this.evmMultiClient.getClientByChain(this.l1Chain)
      let provenBlockNumber: bigint
      try {
        // Try getProvenBlockNumber first
        provenBlockNumber = (await l1Client.publicClient.readContract({
          address: AZTEC_ROLLUP_CONTRACT_L1_ADDRESS,
          args: [],
          abi: rollupAbi,
          functionName: "getProvenBlockNumber",
        })) as bigint
      } catch (provenError) {
        // Fallback to getTips, which returns [pending, proven]
        try {
          const tips = (await l1Client.publicClient.readContract({
            address: AZTEC_ROLLUP_CONTRACT_L1_ADDRESS,
            args: [],
            abi: rollupAbi,
            functionName: "getTips",
          })) as [bigint, bigint]
          provenBlockNumber = tips[1]
        } catch (error) {
          if (IS_SANDBOX_ENV) {
            this.logger.warn(
              `skipping forwardSettleToL2 for order ${order.orderId} because proven block number is unavailable: ${String(
                (error as Error).message ?? error,
              )}`,
            )
            return
          }

          provenBlockNumber = orderSettlementBlockNumber
          this.logger.error(
            `Failed to get proven block number for order ${order.orderId}: ${String((error as Error).message ?? error)}`,
          )
        }
      }

      if (orderSettlementBlockNumber > provenBlockNumber) {
        this.logger.info(
          `cannot forward settlement to L2 for order ${order.orderId} because the corresponding block number ${orderSettlementBlockNumber} is > than the last proven ${provenBlockNumber} ...`,
        )
        return
      }

      let witness

      witness = await computeL2ToL1MembershipWitness(
        this.aztecWallet.getAztecNode(),
        BlockNumber.fromBigInt(orderSettlementBlockNumber),
        l2ToL1Message,
      )

      if (!witness) {
        throw new Error(`Failed to compute L2ToL1 membership witness for order ${order.orderId}`)
      }

      const { root, leafIndex: l2ToL1MessageIndex, siblingPath } = witness

      // @ts-ignore
      const forwardSettleTxHash = await l1Client.walletClient.writeContract({
        abi: forwarderAbi,
        // account: l1Client.account.address,
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
          siblingPath.toBufferArray().map((buff: any) => "0x" + buff.toString("hex")),
        ],
        chain: this.l1Chain,
        functionName: "forwardSettleToL2",
      })
      this.logger.info(
        `waiting for forwardSettleToL2 transaction confirmation of ${forwardSettleTxHash} for order ${order.orderId} ...`,
      )
      await waitForTransactionReceipt(l1Client.publicClient, { hash: forwardSettleTxHash })

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
          } else if (order.resolvedOrder.maxSpent[0].chainId === Number(AZTEC_7683_CHAIN_ID)) {
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
    }
  }

  async settleOrderOnEvmL2(order: Order) {
    const release = await this.settleOrderMutex.acquire()
    try {
      this.logger.info(`settling order ${order.orderId} on L2 ...`)

      const l1Client = this.evmMultiClient.getClientByChain(this.l1Chain)
      const l2Client = this.evmMultiClient.getClientByChain(this.l2EvmChain)

      const message = [
        Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
        Buffer.from(order.orderId.slice(2), "hex"),
        Buffer.from(order.fillerData!.slice(2), "hex"),
      ]
      const messageHash = sha256ToField(message)

      const { parentBeaconBlockRoot: beaconRoot, timestamp: beaconOracleTimestamp } =
        await l2Client.publicClient.getBlock()

      this.logger.info(`Fetching beacon block ${beaconRoot} from ${this.beaconApiUrl}`)

      // Alchemy returns JSON by default
      const resp = await fetch(`${this.beaconApiUrl}/eth/v2/beacon/blocks/${beaconRoot}`)

      if (!resp.ok) {
        const errorText = await resp.text()
        throw new Error(`Beacon API returned ${resp.status}: ${errorText.substring(0, 200)}`)
      }

      const beaconData = (await resp.json()) as any

      this.logger.info(`Received beacon block for slot ${beaconData.data.message.slot}`)

      // Parse the beacon block from JSON
      const beaconBlock = beaconData.data.message
      const l1BlockNumber = BigInt(beaconBlock.body.execution_payload.block_number)

      const stateRootInclusionProof = getExecutionStateRootProof(beaconBlock)
      const storageKey = keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }],
          [messageHash.toString(), FORWARDER_SETTLE_ORDER_SLOT],
        ),
      )
      const proof = await l1Client.publicClient.getProof({
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
      const settleTxHash = await l2Client.walletClient.writeContract({
        address: this.l2EvmGatewayAddress,
        chain: this.l2EvmChain,
        functionName: "settle",
        args: [bytesToHex(Buffer.concat([...message])), stateRootParameters, accountProofParameters],
        abi: l2Gateway7683Abi,
      })
      this.logger.info(`waiting for transaction confirmation of ${settleTxHash} ...`)
      await waitForTransactionReceipt(l2Client.publicClient, { hash: settleTxHash })

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
    } finally {
      release()
    }
  }
}

export default SettlementService
