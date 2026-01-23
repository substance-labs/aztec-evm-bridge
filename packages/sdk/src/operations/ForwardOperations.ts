import { Chain, createPublicClient, encodeAbiParameters, Hex, http, keccak256, padHex } from "viem"
import { computeL2ToL1MessageHash } from "@aztec/stdlib/hash"
import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { sha256ToField } from "@aztec/foundation/crypto/sha256"
import { hexToBuffer } from "@aztec/foundation/string"

import {
  AZTEC_VERSION,
  L2_GATEWAY_FILLED_ORDERS_SLOT,
  L2_GATEWAY_REFUNDED_ORDERS_SLOT,
  REFUND_ORDER_TYPE,
  SETTLE_ORDER_TYPE,
} from "../constants"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import rollupAbi from "../utils/abi/rollup"
import forwarderAbi from "../utils/abi/forwarder"
import anchorRegistryAbi from "../utils/abi/anchorRegistry"

import type { ForwardDetails, ForwardDetailsInternal } from "../types"
import { BridgeContext } from "../context/BridgeContext"

export class ForwardOperations {
  constructor(private context: BridgeContext) {}

  private getAztecChainId(): number {
    return this.context.getAztecChainId()
  }

  async forwardRefundOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    const aztecChainId = this.getAztecChainId()
    if (chainIdOut === aztecChainId) {
      return this.forwardToL2({ ...details, type: "forwardRefundToL2" })
    } else if (chainIdIn === aztecChainId) {
      return this.forwardToAztec({ ...details, type: "forwardRefundToAztec" })
    }
    throw new Error("Neither chain is Aztec")
  }

  async forwardSettleOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    const aztecChainId = this.getAztecChainId()
    if (chainIdOut === aztecChainId) {
      return this.forwardToL2({ ...details, type: "forwardSettleToL2" })
    } else if (chainIdIn === aztecChainId) {
      return this.forwardToAztec({ ...details, type: "forwardSettleToAztec" })
    }
    throw new Error("Neither chain is Aztec")
  }

  async finalizeForwardRefundOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    const aztecChainId = this.getAztecChainId()
    if (chainIdOut === aztecChainId) {
      return this.finalizeForwardToL2({
        ...details,
        type: "forwardRefundToL2",
      })
    } else if (chainIdIn === aztecChainId) {
      return this.finalizeForwardRefundOrderToAztec(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  async finalizeForwardSettleOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    const aztecChainId = this.getAztecChainId()
    if (chainIdOut === aztecChainId) {
      return this.finalizeForwardToL2({
        ...details,
        type: "forwardSettleToL2",
      })
    } else if (chainIdIn === aztecChainId) {
      return this.finalizeForwardSettleOrderToAztec(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  private async forwardToL2(details: ForwardDetailsInternal): Promise<Hex> {
    const { chainIdForwarder, chainIdIn, chainIdOut, fillerData, orderId, type } = details
    if (!chainIdForwarder) throw new Error("You must specify a forwarder chain")
    const { gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)

    const rollupAddress = this.context.aztecRollupContractL1Address
    const forwarderAddress = this.context.forwarderAddress
    if (!rollupAddress || !forwarderAddress) throw new Error("Forwarder chain not supported")

    const message =
      type === "forwardRefundToL2"
        ? [hexToBuffer(REFUND_ORDER_TYPE), hexToBuffer(orderId)]
        : [hexToBuffer(SETTLE_ORDER_TYPE), hexToBuffer(orderId), hexToBuffer(padHex(fillerData!))]
    const messageHash = sha256ToField(message)
    const forwarderChain = this.context.getForwarderChain()

    const l2ToL1MessageHash = computeL2ToL1MessageHash({
      l2Sender: AztecAddress.fromString(gatewayOut),
      l1Recipient: EthAddress.fromString(forwarderAddress),
      content: Fr.fromString(messageHash.toString()),
      rollupVersion: Fr.fromString(AZTEC_VERSION.toString()),
      chainId: Fr.fromString(forwarderChain.id.toString()),
    })

    await this.context.maybeRegisterAztecGateway()
    const getRefundOrSettlementBlockNumber = async (): Promise<bigint> => {
      const wallet = await this.context.getAztecWallet()
      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)
      return (await gateway.methods[
        type === "forwardRefundToL2" ? "get_order_refund_block_number" : "get_order_settlement_block_number"
      ](Fr.fromBufferReduce(hexToBuffer(orderId))).simulate({
        from: (await this.context.getAztecAccount()).getAddress(),
      })) as bigint
    }

    const aztecMessageBlockNumber = await getRefundOrSettlementBlockNumber()
    if (aztecMessageBlockNumber === 0n)
      throw new Error(`Order ${type === "forwardRefundToL2" ? "refund" : "settlement"} block number not found`)
    const aztecProvenBlockNumber = (await createPublicClient({
      chain: forwarderChain,
      transport: http(),
    }).readContract({
      address: rollupAddress,
      args: [],
      abi: rollupAbi,
      functionName: "getProvenBlockNumber",
    })) as bigint
    if (aztecMessageBlockNumber > aztecProvenBlockNumber) {
      throw new Error(
        `cannot forward to L2 for order ${orderId} because the corresponding block number ${aztecMessageBlockNumber} is > than the last proven ${aztecProvenBlockNumber}!`,
      )
    }

    // TODO: implement forward
    throw new Error("Forward to L2 not yet supported in SDK v2")

    /* const wallet = await this.context.getAztecWallet()
    const node = createAztecNodeClient(this.context.aztecNodeUrl!)
    const [l2ToL1MessageIndex, siblingPath] = await node.getL2ToL1MembershipWitness(
      parseInt(aztecMessageBlockNumber.toString()),
      l2ToL1MessageHash,
    )

    const { walletClient, address } = await this.context.getEvmWalletClientAndAddress(chainForwarder)
    return await walletClient.writeContract({
      abi: forwarderAbi,
      account: this.context.evmPrivateKey ? walletClient.account! : address,
      address: forwarderAddress,
      args: [
        {
          sender: {
            actor: gatewayOut,
            version: AZTEC_VERSION,
          },
          recipient: {
            actor: forwarderAddress,
            chainId: chainForwarder.id,
          },
          content: messageHash.toString(),
        },
        bytesToHex(Buffer.concat([...message])),
        BigInt(aztecMessageBlockNumber),
        BigInt(l2ToL1MessageIndex),
        siblingPath.toBufferArray().map((buf) => padHex(bytesToHex(buf))),
      ],
      chain: chainForwarder,
      functionName: type === "forwardRefundToL2" ? "forwardRefundToL2" : "forwardSettleToL2",
    }) */
  }

  private async forwardToAztec(details: ForwardDetailsInternal): Promise<Hex> {
    const { chainIdForwarder, chainIdIn, chainIdOut, fillerData, fillTransactionHash, orderId, originData, type } =
      details
    if (!originData || !fillerData || !fillTransactionHash) {
      throw new Error("You must specify originData, fillerData and fillTransactionHash")
    }
    const forwarderChain = this.context.getForwarderChain()
    if (chainIdForwarder !== forwarderChain.id) {
      throw new Error(`chainForwarder must be ${forwarderChain.id}`)
    }
    const internalChainOut = this.context.getChainByChainId(chainIdOut)
    if (internalChainOut.type !== "EVM") throw new Error("chainOut must be an EVM chain")
    const chainOut = internalChainOut.chain
    const { gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)

    const forwarderAddress = this.context.forwarderAddress
    if (!forwarderAddress) throw new Error("Forwarder chain not supported")
    const opStackAnchorRegistryAddress = this.context.opStackAnchorRegistryAddress
    if (!opStackAnchorRegistryAddress) throw new Error("Invalid chainForwarder")

    const [_, l2EvmAnchorRootblockNumber] = (await createPublicClient({
      chain: forwarderChain,
      transport: http(),
    }).readContract({
      abi: anchorRegistryAbi,
      functionName: "getAnchorRoot",
      args: [],
      address: opStackAnchorRegistryAddress,
    })) as [Hex, bigint]

    const l2EvmClient = createPublicClient({
      chain: chainOut,
      transport: http(),
    })

    const receipt = await l2EvmClient.getTransactionReceipt({ hash: fillTransactionHash })
    if (receipt.blockNumber > l2EvmAnchorRootblockNumber) {
      throw new Error(
        `cannot forward to Aztec for order ${orderId} because the corresponding block number ${receipt.blockNumber} is > than the anchor root one ${l2EvmAnchorRootblockNumber} ...`,
      )
    }

    const storageKey = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [orderId, type === "forwardSettleToAztec" ? L2_GATEWAY_FILLED_ORDERS_SLOT : L2_GATEWAY_REFUNDED_ORDERS_SLOT],
      ),
    )
    const proof = await l2EvmClient.request({
      method: "eth_getProof",
      params: [gatewayOut, [storageKey], `0x${l2EvmAnchorRootblockNumber.toString(16)}`],
    })

    const accountProofParameters = {
      storageKey: proof.storageProof[0]!.key,
      storageValue: proof.storageProof[0]!.value,
      accountProof: proof.accountProof,
      storageProof: proof.storageProof[0]!.proof,
    }

    const { walletClient, address } = await this.context.getEvmWalletClientAndAddress(forwarderChain)
    return await walletClient.writeContract({
      abi: forwarderAbi,
      account: this.context.evmPrivateKey ? walletClient.account! : address,
      address: forwarderAddress,
      args: [orderId, originData, fillerData, accountProofParameters],
      chain: forwarderChain,
      functionName: type === "forwardSettleToAztec" ? "forwardSettleToAztec" : "forwardRefundToAztec",
    })
  }

  private async finalizeForwardToL2(details: ForwardDetailsInternal): Promise<Hex> {
    const { chainIdForwarder, chainIdIn, chainIdOut, fillerData, orderId, type } = details
    const forwarderChain = this.context.getForwarderChain()
    if (chainIdForwarder !== forwarderChain.id) {
      throw new Error(`chainForwarder must be ${forwarderChain.id}`)
    }
    const { chainIn, chainOut: internalChainOut } = this.context.getChainInAndOutByChainIds(chainIdIn, chainIdOut)
    if (internalChainOut.type !== "EVM") throw new Error("chainOut must be an EVM chain")
    const chainOut = internalChainOut.chain
    const { gatewayIn } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)
    const forwarderAddress = this.context.forwarderAddress
    if (!forwarderAddress) throw new Error("Forwarder chain not supported")

    const message =
      type === "forwardRefundToL2"
        ? [hexToBuffer(REFUND_ORDER_TYPE), hexToBuffer(orderId)]
        : [hexToBuffer(SETTLE_ORDER_TYPE), hexToBuffer(orderId), hexToBuffer(padHex(fillerData!))]
    const messageHash = sha256ToField(message)

    const { parentBeaconBlockRoot: beaconRoot, timestamp: beaconOracleTimestamp } = await createPublicClient({
      chain: chainOut as Chain,
      transport: http(),
    }).getBlock()

    if (!this.context.beaconApiUrl) throw new Error("Beacon api url not specified")
    const resp = await fetch(`${this.context.beaconApiUrl}/eth/v2/beacon/blocks/${beaconRoot}`, {
      headers: { Accept: "application/octet-stream" },
    })

    // TODO: Beacon block deserialization needs to be re-implemented
    // const beaconBlock = SignedBeaconBlock.deserialize(new Uint8Array(await resp.arrayBuffer())).message
    // const l1BlockNumber = BigInt(beaconBlock.body.executionPayload.blockNumber)
    // const stateRootInclusionProof = getExecutionStateRootProof(beaconBlock)

    throw new Error("Beacon block processing not yet implemented in this version")

    /* Unreachable code - commented out until beacon block processing is restored
    const storageKey = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [
          messageHash.toString(),
          type === "forwardRefundToL2" ? FORWARDER_REFUNDED_ORDERS_SLOT : FORWARDER_SETTLE_ORDER_SLOT,
        ],
      ),
    )
    const proof = await createPublicClient({
      chain: chainForwarder as Chain,
      transport: http(),
    }).getProof({
      address: forwarderAddress,
      storageKeys: [storageKey],
      blockNumber: l1BlockNumber,
    })

    const accountProofParameters = {
      storageKey: proof.storageProof[0]!.key,
      storageValue: proof.storageProof[0]!.value === 1n ? "0x01" : "0x00",
      accountProof: proof.accountProof,
      storageProof: proof.storageProof[0]!.proof,
    }
    if (accountProofParameters.storageValue === "0x00") {
      throw new Error(`Storage value not up to date yet for order ${orderId} or order not forwarded yet`)
    }

    const stateRootParameters = {
      beaconRoot,
      beaconOracleTimestamp,
      executionStateRoot: stateRootInclusionProof.leaf,
      stateRootProof: stateRootInclusionProof.proof,
    }

    const { address, walletClient } = await this.context.getEvmWalletClientAndAddress(chainIn as Chain)
    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.context.evmPrivateKey ? walletClient.account! : address,
      address: gatewayIn,
      args: [bytesToHex(Buffer.concat([...message])), stateRootParameters, accountProofParameters],
      chain: chainIn as Chain,
      functionName: type === "forwardRefundToL2" ? "refund" : "settle",
    })
    */
  }

  private async finalizeForwardRefundOrderToAztec(details: ForwardDetails): Promise<Hex> {
    throw new Error("Not implemented")
  }

  private async finalizeForwardSettleOrderToAztec(details: ForwardDetails): Promise<Hex> {
    throw new Error("Not implemented")
  }
}
