/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AbiEvent,
  bytesToHex,
  Chain,
  createClient,
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  erc20Abi,
  Hex,
  http,
  keccak256,
  padHex,
} from "viem"
import * as evmChains from "viem/chains"
import { computeL2ToL1MessageHash } from "@aztec/stdlib/hash"
import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxHash, TxReceipt } from "@aztec/aztec.js/tx"
import { sleep } from "@aztec/foundation/sleep"
import { AzguardClient } from "@azguardwallet/client"
import { OkResult, SendTransactionResult, SimulateViewsResult } from "@azguardwallet/types"
import { TokenContract, TokenContractArtifact } from "@defi-wonderland/aztec-standards/current/artifacts/Token.js"
import { AccountWithSecretKey } from "@aztec/aztec.js/account"
import { poseidon2Hash, sha256ToField } from "@aztec/foundation/crypto"
import { privateKeyToAccount } from "viem/accounts"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { hexToBuffer } from "@aztec/foundation/string"

import {
  getAztecAddressFromAzguardAccount,
  getResolvedOrderAndOrderIdEvmByReceipt,
  getResolvedOrderByAztecLogs,
  getSponsoredFPCInstance,
  getSponsporedFeePaymentMethod,
  hexToUintArray,
  OrderDataEncoder,
  parseFilledLog,
  parseResolvedOrderEvm,
  setPublicAuthWit,
} from "./utils"
import {
  AZTEC_VERSION,
  aztecRollupContractL1Addresses,
  aztecSepolia,
  FILLED,
  FILLED_PRIVATELY,
  FORWARDER_REFUNDED_ORDERS_SLOT,
  FORWARDER_SETTLE_ORDER_SLOT,
  forwarderAddresses,
  gatewayAddresses,
  L2_GATEWAY_FILLED_ORDERS_SLOT,
  L2_GATEWAY_REFUNDED_ORDERS_SLOT,
  OPENED,
  opStackAnchorRegistryAddresses,
  ORDER_DATA_TYPE,
  PRIVATE_ORDER,
  PRIVATE_ORDER_WITH_HOOK,
  PRIVATE_SENDER,
  PUBLIC_ORDER,
  PUBLIC_ORDER_WITH_HOOK,
  REFUND_ORDER_TYPE,
  SETTLE_ORDER_TYPE,
} from "./constants"
import {
  AztecGateway7683Contract,
  AztecGateway7683ContractArtifact,
} from "./utils/artifacts/AztecGateway7683/AztecGateway7683"
import l2Gateway7683Abi from "./utils/abi/l2Gateway7683"
import rollupAbi from "./utils/abi/rollup"
import forwarderAbi from "./utils/abi/forwarder"
import anchorRegistryAbi from "./utils/abi/anchorRegistry"

import type {
  BridgeConfigs,
  FilledLog,
  FillOrderDetails,
  ForwardDetails,
  ForwardDetailsInternal,
  InternalChain,
  Order,
  OrderCallbacks,
  OrderData,
  OrderResult,
  RefundOrderDetails,
  ResolvedOrder,
} from "./types"
import type { Wallet } from "@aztec/aztec.js/wallet"

const AZTEC_WAIT_TIMEOUT = 120000

export class Bridge {
  azguardClient?: AzguardClient
  aztecWallet?: Wallet
  beaconApiUrl?: string
  evmPrivateKey?: Hex
  evmProvider?: any
  #wallet?: Wallet
  #account?: AccountWithSecretKey
  #aztecGatewayRegistered = false

  private constructor(configs: BridgeConfigs) {
    const { azguardClient, aztecWallet, beaconApiUrl, evmPrivateKey, evmProvider } = configs

    if (!aztecWallet && !azguardClient) {
      throw new Error("You must specify aztecWallet or azguardClient")
    }

    if (evmPrivateKey && evmProvider) {
      throw new Error("Cannot specify both evmPrivateKey and evmProvider")
    }

    if (azguardClient && aztecWallet) {
      throw new Error("Cannot specify both azguardClient and aztecWallet")
    }

    this.azguardClient = azguardClient
    this.aztecWallet = aztecWallet
    this.beaconApiUrl = beaconApiUrl
    this.evmPrivateKey = evmPrivateKey
    this.evmProvider = evmProvider
  }

  static async create(configs: BridgeConfigs): Promise<Bridge> {
    const bridge = new Bridge(configs)

    // Initialize contracts for non-Azguard wallets
    if (!bridge.azguardClient) {
      await bridge.#maybeRegisterAztecGateway()
    }

    return bridge
  }

  async claimEvmToAztecPrivateOrder(orderId: Hex, secret: Hex): Promise<Hex> {
    const gatewayOut = gatewayAddresses[aztecSepolia.id]
    const log = await this.#getAztecFilledLogByOrderId(orderId)
    if (!log) throw new Error(`Log not found for the specified order id ${orderId}`)

    // Decode order data to get token address for registration
    const decodedOrder = OrderDataEncoder.decode(log.originData as Hex)

    if (this.azguardClient) {
      // NOTE: Azguard currently doesn't expose the actively selected account.
      // As a workaround, we default to using accounts[0], assuming it's the connected one.
      const selectedAccount = this.azguardClient!.accounts[0]
      const [response] = await this.azguardClient!.execute([
        {
          kind: "send_transaction",
          account: selectedAccount,
          actions: [
            {
              kind: "call",
              contract: gatewayOut,
              method: "claim_private",
              args: [
                secret,
                hexToUintArray(orderId),
                hexToUintArray(log.originData as Hex),
                hexToUintArray(log.fillerData as Hex),
              ],
            },
          ],
        },
      ])
      if (response.status === "failed") throw new Error(response.error)
      return (response as OkResult<SendTransactionResult>).result as Hex
    }

    // Register token contract before claiming (for non-Azguard wallets)
    const wallet = await this.#getAztecWallet()
    const tokenAddress = AztecAddress.fromString(decodedOrder.outputToken)
    const tokenInstance = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getContract(tokenAddress)

    if (!tokenInstance) {
      throw new Error(`Token contract instance not found for address ${tokenAddress.toString()}`)
    }

    try {
      await wallet.registerContract({
        instance: tokenInstance,
        artifact: TokenContractArtifact,
      })
    } catch (e) {
      // Token might already be registered, ignore error
      console.warn(`Token contract at ${tokenAddress.toString()} might already be registered.`)
    }

    const account = await this.#getAztecAccount()
    const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)
    const receipt = await gateway.methods
      .claim_private(
        Fr.fromString(secret),
        hexToUintArray(orderId),
        hexToUintArray(log.originData as Hex),
        hexToUintArray(log.fillerData as Hex),
      )
      .send({
        from: account.getAddress(),
        fee: { paymentMethod: await getSponsporedFeePaymentMethod() },
      })
      .wait({
        timeout: AZTEC_WAIT_TIMEOUT,
      })

    return receipt.txHash.toString()
  }

  async fillOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderData } = details
    if (orderData.fillDeadline <= Math.floor(Date.now() / 1000)) throw new Error("Order expired")

    if (orderData.originDomain === aztecSepolia.id) {
      return this.#fillAztecToEvmOrder(details)
    } else if (orderData.destinationDomain === aztecSepolia.id) {
      return this.#fillEvmToAztecOrder(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  async finalizeForwardRefundOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    if (chainIdOut === aztecSepolia.id) {
      return this.#finalizeForwardToL2({
        ...details,
        type: "forwardRefundToL2",
      })
    } else if (chainIdIn === aztecSepolia.id) {
      return this.#finalizeForwardRefundOrderToAztec(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  async finalizeForwardSettleOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    if (chainIdOut === aztecSepolia.id) {
      return this.#finalizeForwardToL2({
        ...details,
        type: "forwardSettleToL2",
      })
    } else if (chainIdIn === aztecSepolia.id) {
      return this.#finalizeForwardSettleOrderToAztec(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  async forwardRefundOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    if (chainIdOut === aztecSepolia.id) {
      return this.#forwardToL2({ ...details, type: "forwardRefundToL2" })
    } else if (chainIdIn === aztecSepolia.id) {
      return this.#forwardToAztec({ ...details, type: "forwardRefundToAztec" })
    }
    throw new Error("Neither chain is Aztec")
  }

  async forwardSettleOrder(details: ForwardDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    if (chainIdOut === aztecSepolia.id) {
      return this.#forwardToL2({ ...details, type: "forwardSettleToL2" })
    } else if (chainIdIn === aztecSepolia.id) {
      return this.#forwardToAztec({ ...details, type: "forwardSettleToAztec" })
    }
    throw new Error("Neither chain is Aztec")
  }

  async openOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const { chainIdIn, chainIdOut, mode, data } = order
    if (chainIdIn === chainIdOut) throw new Error("Invalid chains: source and destination must differ")
    const validModes = ["private", "public", "privateWithHook", "publicWithHook"]
    if (!validModes.includes(mode)) throw new Error(`Invalid mode: ${mode}`)

    if (data.length !== 66) throw new Error("Invalid data: must be 32 bytes")

    if (chainIdIn === aztecSepolia.id) {
      return this.#openAztecToEvmOrder(order, callbacks)
    } else if (chainIdOut === aztecSepolia.id) {
      return this.#openEvmToAztecOrder(order, callbacks)
    } else {
      throw new Error("Neither chain is Aztec")
    }
  }

  async refundOrder(details: RefundOrderDetails): Promise<Hex> {
    const { chainIdIn, chainIdOut } = details
    if (chainIdIn === aztecSepolia.id) {
      return this.#refundAztecToEvmOrder(details)
    } else if (chainIdOut === aztecSepolia.id) {
      return this.#refundEvmToAztecOrder(details)
    }
    throw new Error("Neither chain is Aztec")
  }

  async #fillAztecToEvmOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderId, orderData } = details
    const chainOut = Object.values(evmChains).find((chain: Chain) => chain.id === orderData.destinationDomain)
    if (!chainOut) throw new Error("ChainOut not supported")
    const gatewayOut = gatewayAddresses[chainOut.id]

    const { address, walletClient } = await this.#getEvmWalletClientAndAddress(chainOut)
    const fillerData = padHex(address)

    const publicClient = createPublicClient({
      chain: chainOut as Chain,
      transport: http(),
    })

    const tokenAddress = `0x${orderData.outputToken.slice(26)}` as `0x${string}`

    // Check current allowance
    const currentAllowance = (await publicClient.readContract({
      abi: erc20Abi,
      address: tokenAddress,
      functionName: "allowance",
      args: [address, gatewayOut],
    })) as bigint

    // Only approve if current allowance is insufficient
    if (currentAllowance < orderData.amountOut) {
      const approvalHash = await walletClient.writeContract({
        abi: erc20Abi,
        account: this.evmPrivateKey ? walletClient.account! : address,
        address: tokenAddress,
        args: [gatewayOut, orderData.amountOut],
        chain: chainOut as Chain,
        functionName: "approve",
      })

      // Wait for approval confirmation
      await publicClient.waitForTransactionReceipt({
        hash: approvalHash,
        confirmations: 1,
      })

      // Verify the allowance was set correctly
      const newAllowance = (await publicClient.readContract({
        abi: erc20Abi,
        address: tokenAddress,
        functionName: "allowance",
        args: [address, gatewayOut],
      })) as bigint

      if (newAllowance < orderData.amountOut) {
        throw new Error(
          `Insufficient allowance after approval. Required: ${orderData.amountOut}, Current: ${newAllowance}`,
        )
      }
    }

    // Fill the order
    const orderDataEncoder = new OrderDataEncoder(orderData)
    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: gatewayOut,
      args: [
        orderId,
        orderDataEncoder.encode(),
        fillerData, // NOTE: needed for the settlement
      ],
      chain: chainOut as Chain,
      functionName: "fill",
      // nonce: accountNonce + 1,
    })
  }

  async #fillEvmToAztecOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderId, orderData } = details
    const chainOut = aztecSepolia
    const gatewayOut = gatewayAddresses[chainOut.id]
    const orderType = orderData.orderType
    const isPrivate = orderType === PRIVATE_ORDER || orderType === PRIVATE_ORDER_WITH_HOOK
    const orderDataEncoder = new OrderDataEncoder(orderData)
    await this.#maybeRegisterAztecGateway()

    if (this.azguardClient) {
      const selectedAccount = this.azguardClient.accounts[0]
      const fillerData = getAztecAddressFromAzguardAccount(selectedAccount)
      const response = await this.azguardClient.execute([
        {
          kind: "register_contract",
          chain: `aztec:11155111`,
          address: orderData.outputToken,
          artifact: TokenContractArtifact,
        },
        {
          kind: "send_transaction",
          account: selectedAccount,
          actions: [
            {
              kind: isPrivate ? "add_private_authwit" : "add_public_authwit",
              content: {
                kind: "call",
                caller: gatewayOut,
                contract: orderData.outputToken,
                method: isPrivate ? "transfer_private_to_public" : "transfer_public_to_public",
                args: isPrivate
                  ? [
                      getAztecAddressFromAzguardAccount(selectedAccount),
                      AztecAddress.fromString(gatewayOut), // NOTE: private orders must be claimed by the user
                      orderData.amountOut,
                      orderData.senderNonce,
                    ]
                  : [
                      getAztecAddressFromAzguardAccount(selectedAccount),
                      AztecAddress.fromString(orderData.recipient),
                      orderData.amountOut,
                      orderData.senderNonce,
                    ],
              },
            },
            {
              kind: "call",
              contract: gatewayOut,
              method: isPrivate ? "fill_private" : "fill",
              args: [hexToUintArray(orderId), hexToUintArray(orderDataEncoder.encode()), hexToUintArray(fillerData)],
            },
          ],
        },
      ])
      for (const res of response) if (res.status === "failed") throw new Error(res.error)
      return (response[1] as OkResult<SendTransactionResult>).result as Hex
    }

    const wallet = await this.#getAztecWallet()
    const account = await this.#getAztecAccount()
    const fillerData = account.getAddress().toString()

    const tokenInstance = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getContract(
      AztecAddress.fromString(orderData.outputToken),
    )
    if (!tokenInstance) {
      throw new Error(`Token contract instance not found for address ${orderData.outputToken}`)
    }
    await wallet.registerContract({ instance: tokenInstance, artifact: TokenContractArtifact })
    const [token, aztecGateway] = await Promise.all([
      TokenContract.at(AztecAddress.fromString(orderData.outputToken), wallet),
      AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet),
    ])

    let witness
    if (isPrivate) {
      witness = await account.createAuthWit({
        caller: AztecAddress.fromString(gatewayOut),
        action: token.methods.transfer_private_to_public(
          account.getAddress(),
          AztecAddress.fromString(gatewayOut), // NOTE: private orders must be claimed by the user
          orderData.amountOut,
          orderData.senderNonce,
        ),
      } as any)
    } else {
      await (
        await setPublicAuthWit(
          wallet,
          account.getAddress(),
          {
            caller: AztecAddress.fromString(gatewayOut),
            action: token.methods.transfer_public_to_public(
              account.getAddress(),
              AztecAddress.fromString(orderData.recipient),
              orderData.amountOut,
              orderData.senderNonce,
            ),
          },
          true,
        )
      )
        .send({ fee: { paymentMethod: await getSponsporedFeePaymentMethod() } })
        .wait({
          timeout: AZTEC_WAIT_TIMEOUT,
        })
    }

    const receipt = await aztecGateway.methods[isPrivate ? "fill_private" : "fill"](
      hexToUintArray(orderId),
      hexToUintArray(orderDataEncoder.encode()),
      hexToUintArray(fillerData),
    )
      .with({
        authWitnesses: witness ? [witness] : [],
      })
      .send({
        from: account.getAddress(),
        fee: { paymentMethod: await getSponsporedFeePaymentMethod() },
      })
      .wait({
        timeout: AZTEC_WAIT_TIMEOUT,
      })

    return receipt.txHash.toString()
  }

  async #finalizeForwardRefundOrderToAztec(details: ForwardDetails): Promise<Hex> {
    throw new Error("Not implemented")
  }

  async #finalizeForwardSettleOrderToAztec(details: ForwardDetails): Promise<Hex> {
    throw new Error("Not implemented")
  }

  async #finalizeForwardToL2(details: ForwardDetailsInternal): Promise<Hex> {
    const { chainIdForwarder, chainIdIn, chainIdOut, fillerData, orderId, type } = details
    if (!chainIdForwarder) throw new Error("You must specify a forwarder chain")
    const chainForwarder = this.#getChainByChainId(chainIdForwarder)
    const { chainIn, chainOut } = this.#getChainInAndOutByChainIds(chainIdIn, chainIdOut)
    const { gatewayIn } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)
    const forwarderAddress = forwarderAddresses[chainForwarder.id]
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

    if (!this.beaconApiUrl) throw new Error("Beacon api url not specified")
    const resp = await fetch(`${this.beaconApiUrl}/eth/v2/beacon/blocks/${beaconRoot}`, {
      headers: { Accept: "application/octet-stream" },
    })

    // TODO: Beacon block deserialization needs to be re-implemented
    // const beaconBlock = SignedBeaconBlock.deserialize(new Uint8Array(await resp.arrayBuffer())).message
    // const l1BlockNumber = BigInt(beaconBlock.body.executionPayload.blockNumber)
    // const stateRootInclusionProof = getExecutionStateRootProof(beaconBlock)

    // Temporary workaround until beacon block functionality is restored
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

    const { address, walletClient } = await this.#getEvmWalletClientAndAddress(chainIn as Chain)
    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: gatewayIn,
      args: [bytesToHex(Buffer.concat([...message])), stateRootParameters, accountProofParameters],
      chain: chainIn as Chain,
      functionName: type === "forwardRefundToL2" ? "refund" : "settle",
    })
    */
  }

  async #forwardToAztec(details: ForwardDetailsInternal): Promise<Hex> {
    const { chainIdForwarder, chainIdIn, chainIdOut, fillerData, fillTransactionHash, orderId, originData, type } =
      details
    if (!originData || !fillerData || !fillTransactionHash) {
      // TODO: add indexed to Filled.orderId log and search the Filled log by the orderId
      throw new Error("You must specify originData, fillerData and fillTransactionHash")
    }
    if (!chainIdForwarder) throw new Error("You must set a value for chainForwarder")
    const chainForwarder = this.#getChainByChainId(chainIdForwarder) as Chain
    const chainOut = this.#getChainByChainId(chainIdOut) as Chain
    const { gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)

    const forwarderAddress = forwarderAddresses[chainForwarder.id]
    if (!forwarderAddress) throw new Error("Forwarder chain not supported")
    const opStackAnchorRegistryAddress = opStackAnchorRegistryAddresses[chainIdForwarder]
    if (!opStackAnchorRegistryAddress) throw new Error("Invalid chainForwarder")

    const [_, l2EvmAnchorRootblockNumber] = (await createPublicClient({
      chain: chainForwarder,
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

    const { walletClient, address } = await this.#getEvmWalletClientAndAddress(chainForwarder)
    return await walletClient.writeContract({
      abi: forwarderAbi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: forwarderAddress,
      args: [orderId, originData, fillerData, accountProofParameters],
      chain: chainForwarder,
      functionName: type === "forwardSettleToAztec" ? "forwardSettleToAztec" : "forwardRefundToAztec",
    })
  }

  async #forwardToL2(details: ForwardDetailsInternal): Promise<Hex> {
    const { chainIdForwarder, chainIdIn, chainIdOut, fillerData, orderId, type } = details
    if (!chainIdForwarder) throw new Error("You must specify a forwarder chain")
    const chainForwarder = this.#getChainByChainId(chainIdForwarder) as Chain
    const { gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)

    const rollupAddress = aztecRollupContractL1Addresses[chainForwarder.id]
    const forwarderAddress = forwarderAddresses[chainForwarder.id]
    if (!rollupAddress || !forwarderAddress) throw new Error("Forwarder chain not supported")

    const message =
      type === "forwardRefundToL2"
        ? [hexToBuffer(REFUND_ORDER_TYPE), hexToBuffer(orderId)]
        : [hexToBuffer(SETTLE_ORDER_TYPE), hexToBuffer(orderId), hexToBuffer(padHex(fillerData!))]
    const messageHash = sha256ToField(message)

    const l2ToL1MessageHash = computeL2ToL1MessageHash({
      l2Sender: AztecAddress.fromString(gatewayOut),
      l1Recipient: EthAddress.fromString(forwarderAddress),
      content: messageHash,
      rollupVersion: Fr.fromString(AZTEC_VERSION.toString()),
      chainId: Fr.fromString(chainForwarder.id.toString()),
    })

    await this.#maybeRegisterAztecGateway()
    const getRefundOrSettlementBlockNumber = async (): Promise<bigint> => {
      const wallet = await this.#getAztecWallet()
      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)
      return (await gateway.methods[
        type === "forwardRefundToL2" ? "get_order_refund_block_number" : "get_order_settlement_block_number"
      ](Fr.fromBufferReduce(hexToBuffer(orderId))).simulate({
        from: (await this.#getAztecAccount()).getAddress(),
      })) as bigint
    }

    const aztecMessageBlockNumber = await getRefundOrSettlementBlockNumber()
    if (aztecMessageBlockNumber === 0n)
      throw new Error(`Order ${type === "forwardRefundToL2" ? "refund" : "settlement"} block number not found`)
    const aztecProvenBlockNumber = (await createPublicClient({
      chain: chainForwarder,
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

    // TODO: v3 migration - getL2ToL1MembershipWitness not available on AztecNode in v3
    // This feature needs to be re-implemented using v3 APIs
    throw new Error("Forward to L2 not yet supported in Aztec v3 - getL2ToL1MembershipWitness API changed")

    /* const wallet = await this.#getAztecWallet()
    const node = createAztecNodeClient(this.aztecNodeUrl!)
    const [l2ToL1MessageIndex, siblingPath] = await node.getL2ToL1MembershipWitness(
      parseInt(aztecMessageBlockNumber.toString()),
      l2ToL1MessageHash,
    )

    const { walletClient, address } = await this.#getEvmWalletClientAndAddress(chainForwarder)
    return await walletClient.writeContract({
      abi: forwarderAbi,
      account: this.evmPrivateKey ? walletClient.account! : address,
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

  async #getAztecWallet(): Promise<Wallet> {
    if (!this.#wallet) {
      if (!this.aztecWallet) {
        throw new Error("No Aztec wallet provided. Please provide an aztecWallet in BridgeConfigs.")
      }
      this.#wallet = this.aztecWallet
    }

    return this.#wallet
  }

  async #getAztecAccount(): Promise<AccountWithSecretKey> {
    if (!this.#account) {
      const wallet = await this.#getAztecWallet()

      // Get the first registered account from the wallet
      const accounts = await wallet.getAccounts()
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts found in the provided wallet. Please register an account with the wallet first.")
      }

      // Get the account from the wallet's internal account management
      const accountAddress = accounts[0].item
      this.#account = (await (wallet as any).getAccountFromAddress(accountAddress)) as AccountWithSecretKey

      if (!this.#account) {
        throw new Error(`Could not retrieve account ${accountAddress.toString()} from wallet`)
      }
    }

    return this.#account!
  }

  #getChainInAndOutByChainIds(
    chainIdIn: Order["chainIdIn"],
    chainIdOut: Order["chainIdOut"],
  ): {
    chainIn: InternalChain
    chainOut: InternalChain
  } {
    return {
      chainIn: this.#getChainByChainId(chainIdIn),
      chainOut: this.#getChainByChainId(chainIdOut),
    }
  }

  #getChainByChainId(chainId: number): InternalChain {
    const chains = [...Object.values(evmChains), aztecSepolia] as InternalChain[]
    const chain = chains.find((c) => c.id === chainId)
    if (!chain) throw new Error("Chain not found")
    return chain
  }

  async #getEvmWalletClientAndAddress(chain: Chain) {
    const walletClient = this.evmProvider
      ? createWalletClient({
          chain,
          transport: custom(this.evmProvider),
        })
      : createWalletClient({
          chain,
          account: privateKeyToAccount(this.evmPrivateKey!),
          transport: http(),
        })

    let address
    if (walletClient.account) {
      // privateKeyToAccount
      address = walletClient.account.address
    } else {
      // window.ethereum
      ;[address] = await walletClient.getAddresses()
    }
    return {
      walletClient,
      address,
    }
  }

  #getOrderType(mode: Order["mode"]): number {
    switch (mode) {
      case "private":
        return PRIVATE_ORDER
      case "privateWithHook":
        return PRIVATE_ORDER_WITH_HOOK
      case "public":
        return PUBLIC_ORDER
      case "publicWithHook":
        return PUBLIC_ORDER_WITH_HOOK
      default:
        throw new Error("Invalid mode")
    }
  }

  #getGatewaysByChainIds(
    chainIdIn: Order["chainIdIn"],
    chainIdOut: Order["chainIdOut"],
  ): {
    gatewayIn: Hex
    gatewayOut: Hex
  } {
    const gatewayIn = gatewayAddresses[chainIdIn]
    if (!gatewayIn) throw new Error("Unsupported source chain")
    const gatewayOut = gatewayAddresses[chainIdOut]
    if (!gatewayOut) throw new Error("Unsupported destination chain")
    return {
      gatewayIn,
      gatewayOut,
    }
  }

  async #getAztecFilledLogByOrderId(orderId: Hex): Promise<FilledLog | undefined> {
    // TODO: understand why if i use fromBlock and toBlock i always receive the penultimante log.
    // Basically i never receive the last one even if block numbers are up to date
    const gateway = gatewayAddresses[aztecSepolia.id]
    const { logs } = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })
    console.log("Fetched logs:", logs.length)
    console.log("Looking for orderId:", orderId)

    // Filter for Filled events (they have 13 fields: fields[0-12])
    // Open events have 13 fields but different structure
    const filledLogs = logs.filter(({ log }) => log.fields.length === 13 && log.fields[11] !== undefined)
    console.log("Filled logs count:", filledLogs.length)

    const parsedLogs = filledLogs.map(({ log }) => parseFilledLog(log.fields))
    return parsedLogs.find((log) => log.orderId === orderId)
  }

  async #getAztecOpenLogByOrderId(orderId: Hex): Promise<ResolvedOrder | undefined> {
    // TODO: understand why if i use fromBlock and toBlock i always receive the penultimante log.
    // Basically i never receive the last one even if block numbers are up to date
    const gateway = gatewayAddresses[aztecSepolia.id]
    const { logs } = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })
    const parsedOpenLogs = getResolvedOrderByAztecLogs(logs)
    return parsedOpenLogs.find((order) => order.orderId === orderId)
  }

  async #monitorAztecToEvmOrder(
    order: Order,
    receipt: TxReceipt,
    callbacks?: OrderCallbacks,
  ): Promise<{ transactionHash: Hex; resolvedOrder: ResolvedOrder }> {
    const { chainIdIn, chainIdOut } = order
    const { onOrderOpened, onOrderFilled } = callbacks || {}
    const { chainIn, chainOut } = this.#getChainInAndOutByChainIds(chainIdIn, chainIdOut)
    const { gatewayIn, gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)

    if (chainIdIn !== aztecSepolia.id) throw new Error("Chain in is not Aztec")
    const { logs } = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getPublicLogs({
      fromBlock: receipt.blockNumber! - 1,
      toBlock: receipt.blockNumber! + 1,
      contractAddress: AztecAddress.fromString(gatewayIn),
    })
    // TODO: handle multiple orders in the same tx
    const [resolvedOrder] = getResolvedOrderByAztecLogs(logs)
    onOrderOpened?.({ orderId: resolvedOrder.orderId, transactionHash: receipt.txHash.toString(), resolvedOrder })

    const evmPublicClient = createPublicClient({
      chain: chainOut as Chain,
      transport: http(),
    })
    const waitForFilledOrder = async (orderId: Hex): Promise<Hex> => {
      while (true) {
        const result = (await evmPublicClient.readContract({
          address: gatewayOut,
          abi: l2Gateway7683Abi,
          functionName: "filledOrders",
          args: [orderId],
        })) as [Hex, Hex]
        if (result[0] !== "0x" && result[1] !== "0x") break
        await sleep(5000)
      }

      const currentBlock = await evmPublicClient.getBlockNumber()
      const [log] = await evmPublicClient.getLogs({
        address: gatewayOut,
        event: l2Gateway7683Abi.find((el) => el.type === "event" && el.name === "Filled") as AbiEvent,
        args: {
          orderId,
        },
        fromBlock: currentBlock - 100n,
        toBlock: currentBlock,
      })
      return log.transactionHash
    }
    const orderFilledTxHash = await waitForFilledOrder(resolvedOrder.orderId)
    onOrderFilled?.({ orderId: resolvedOrder.orderId, transactionHash: orderFilledTxHash })
    return { transactionHash: orderFilledTxHash, resolvedOrder }
  }

  async #monitorEvmToAztecOrder(order: Order, orderId: Hex, callbacks?: OrderCallbacks) {
    const { chainIdIn, chainIdOut } = order
    const { onOrderFilled } = callbacks || {}
    const { chainIn, chainOut } = this.#getChainInAndOutByChainIds(chainIdIn, chainIdOut)
    const { gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)
    await this.#maybeRegisterAztecGateway()

    if (this.azguardClient) {
      // NOTE: Azguard currently doesn't expose the actively selected account.
      // As a workaround, we default to using accounts[0], assuming it's the connected one.
      const selectedAccount = this.azguardClient!.accounts[0]
      while (true) {
        const [response] = await this.azguardClient!.execute([
          {
            kind: "simulate_views",
            account: selectedAccount,
            calls: [
              {
                kind: "call",
                contract: gatewayOut,
                method: "get_order_status",
                args: [orderId],
              },
            ],
          },
        ])
        if (response.status === "failed") throw new Error(response.error)
        const status = parseInt(BigInt((response as OkResult<SimulateViewsResult>).result.encoded[0][0]).toString())
        if (status === FILLED_PRIVATELY || status === FILLED) {
          onOrderFilled?.({ orderId })
          return
        }
        await sleep(3000)
      }
    }

    const wallet = await this.#getAztecWallet!()
    const account = await this.#getAztecAccount()
    while (true) {
      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)
      const status = parseInt(
        await gateway.methods.get_order_status(Fr.fromString(orderId)).simulate({ from: account.getAddress() }),
      )
      if (status === FILLED_PRIVATELY || status === FILLED) {
        onOrderFilled?.({ orderId })
        return
      }
      await sleep(3000)
    }
  }

  async #maybeRegisterAztecGateway(): Promise<void> {
    const gateway = gatewayAddresses[aztecSepolia.id]
    if (!this.#aztecGatewayRegistered) {
      if (this.azguardClient) {
        await this.azguardClient!.execute([
          {
            kind: "register_contract",
            chain: `aztec:11155111`,
            address: gateway,
            artifact: AztecGateway7683ContractArtifact,
          },
        ])
      } else {
        const wallet = await this.#getAztecWallet()
        const instance = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getContract(
          AztecAddress.fromString(gateway),
        )
        if (!instance) {
          throw new Error(`Contract instance not found for gateway address ${gateway}`)
        }
        await wallet.registerContract({ instance, artifact: AztecGateway7683Contract.artifact })

        // Register the Sponsored FPC contract
        const sponsoredFPC = await getSponsoredFPCInstance()
        await wallet.registerContract({
          instance: sponsoredFPC,
          artifact: SponsoredFPCContractArtifact,
        })
      }
      this.#aztecGatewayRegistered = true
    }
  }

  async #openAztecToEvmOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const { amountIn, amountOut, chainIdIn, chainIdOut, data, mode, recipient, tokenIn, tokenOut } = order
    const { gatewayIn, gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)
    const fillDeadline = order.fillDeadline ?? 2 ** 32 - 1
    const nonce = Fr.random()
    const isPrivate = mode.includes("private")
    const baseOrderData = {
      recipient: padHex(recipient),
      inputToken: padHex(tokenIn),
      outputToken: padHex(tokenOut),
      amountIn,
      amountOut,
      senderNonce: nonce.toBigInt(),
      originDomain: chainIdIn,
      destinationDomain: chainIdOut,
      destinationSettler: padHex(gatewayOut),
      fillDeadline,
      orderType: this.#getOrderType(mode),
      data: data || padHex("0x"),
    }
    await this.#maybeRegisterAztecGateway()

    let orderOpenedReceipt
    if (this.azguardClient) {
      // NOTE: Azguard currently doesn't expose the actively selected account.
      // As a workaround, we default to using accounts[0], assuming it's the connected one.
      const selectedAccount = this.azguardClient!.accounts[0]

      const orderDataEncoder = new OrderDataEncoder({
        ...baseOrderData,
        sender: isPrivate ? PRIVATE_SENDER : getAztecAddressFromAzguardAccount(selectedAccount),
      })
      const response = await this.azguardClient!.execute([
        {
          kind: "register_contract",
          chain: `aztec:11155111`,
          address: tokenIn,
          artifact: TokenContractArtifact,
        },
        {
          kind: "send_transaction",
          account: selectedAccount,
          actions: [
            {
              kind: isPrivate ? "add_private_authwit" : "add_public_authwit",
              content: {
                kind: "call",
                caller: gatewayIn,
                contract: tokenIn,
                method: isPrivate ? "transfer_private_to_public" : "transfer_public_to_public",
                args: [getAztecAddressFromAzguardAccount(selectedAccount), gatewayIn, amountIn, nonce],
              },
            },
            {
              kind: "call",
              contract: gatewayIn,
              method: isPrivate ? "open_private" : "open",
              args: [
                {
                  fill_deadline: fillDeadline,
                  order_data: hexToUintArray(orderDataEncoder.encode()),
                  order_data_type: hexToUintArray(ORDER_DATA_TYPE),
                },
              ],
            },
          ],
        },
      ])
      for (const res of response) if (res.status === "failed") throw new Error(res.error)
      const orderOpenedTxHash = (response[1] as OkResult<SendTransactionResult>).result as Hex

      const waitForReceipt = async (txHash: string): Promise<TxReceipt> => {
        while (true) {
          const receipt = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getTxReceipt(
            TxHash.fromString(txHash),
          )
          if (receipt.status === "success") return receipt
          if (receipt.status === "pending") {
            await sleep(5000)
            continue
          }
          throw new Error("Aztec transaction failed")
        }
      }
      orderOpenedReceipt = await waitForReceipt(orderOpenedTxHash)
    } else {
      const wallet = await this.#getAztecWallet()
      const account = await this.#getAztecAccount()
      const tokenInstance = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getContract(
        AztecAddress.fromString(tokenIn),
      )
      if (!tokenInstance) {
        throw new Error(`Token contract instance not found for address ${tokenIn}`)
      }
      await wallet.registerContract({ instance: tokenInstance, artifact: TokenContractArtifact })
      const orderDataEncoder = new OrderDataEncoder({
        ...baseOrderData,
        sender: isPrivate ? PRIVATE_SENDER : account.getAddress().toString(),
      })

      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayIn), wallet)
      const token = await TokenContract.at(AztecAddress.fromString(tokenIn), wallet)
      let witness
      if (isPrivate) {
        witness = await account.createAuthWit({
          caller: AztecAddress.fromString(gatewayIn),
          action: token.methods.transfer_private_to_public(
            account.getAddress(),
            AztecAddress.fromString(gatewayIn),
            amountIn,
            nonce,
          ),
        } as any)
      } else {
        await (
          await setPublicAuthWit(
            wallet,
            account.getAddress(),
            {
              caller: AztecAddress.fromString(gatewayIn),
              action: token.methods.transfer_public_to_public(
                account.getAddress(),
                AztecAddress.fromString(gatewayIn),
                amountIn,
                nonce,
              ),
            },
            true,
          )
        )
          .send({ fee: { paymentMethod: await getSponsporedFeePaymentMethod() } })
          .wait({
            timeout: AZTEC_WAIT_TIMEOUT,
          })
      }

      orderOpenedReceipt = await gateway.methods[isPrivate ? "open_private" : "open"]({
        fill_deadline: fillDeadline,
        order_data: hexToUintArray(orderDataEncoder.encode()),
        order_data_type: hexToUintArray(ORDER_DATA_TYPE),
      })
        .with({
          authWitnesses: witness ? [witness] : [],
        })
        .send({
          from: account.getAddress(),
          fee: { paymentMethod: await getSponsporedFeePaymentMethod() },
        })
        .wait({
          timeout: AZTEC_WAIT_TIMEOUT,
        })
    }

    const { transactionHash: orderFilledTxHash, resolvedOrder } = await this.#monitorAztecToEvmOrder(
      order,
      orderOpenedReceipt,
      callbacks,
    )
    return {
      orderOpenedTxHash: orderOpenedReceipt.txHash.toString(),
      orderFilledTxHash,
      resolvedOrder,
    }
  }

  async #openEvmToAztecOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const { amountIn, amountOut, chainIdIn, chainIdOut, data, mode, recipient, tokenIn, tokenOut } = order
    const { onSecret, onOrderOpened, onOrderClaimed } = callbacks || {}
    const { gatewayIn, gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)
    const chainIn = this.#getChainByChainId(chainIdIn)
    const { walletClient, address: sender } = await this.#getEvmWalletClientAndAddress(chainIn as Chain)

    const fillDeadline = order.fillDeadline ?? 2 ** 32 - 1
    const nonce = Fr.random()
    const isPrivate = mode.includes("private")
    const secret = isPrivate ? Fr.random() : null

    const orderData: OrderData = {
      sender: padHex(sender),
      recipient: secret ? (await poseidon2Hash([secret])).toString() : padHex(recipient),
      inputToken: padHex(tokenIn),
      outputToken: padHex(tokenOut),
      amountIn,
      amountOut,
      senderNonce: nonce.toBigInt(),
      originDomain: chainIdIn,
      destinationDomain: chainIdOut,
      destinationSettler: padHex(gatewayOut),
      fillDeadline,
      orderType: isPrivate ? PRIVATE_ORDER : PUBLIC_ORDER,
      data: data || padHex("0x"),
    }
    const orderDataEncoder = new OrderDataEncoder(orderData)

    const publicClient = createPublicClient({
      chain: chainIn as Chain,
      transport: http(),
    })
    const accountAddress = this.evmPrivateKey ? walletClient.account!.address : sender

    // Check token balance
    const balance = await publicClient.readContract({
      abi: erc20Abi,
      address: tokenIn,
      functionName: "balanceOf",
      args: [accountAddress],
    })
    if (balance < amountIn) {
      throw new Error(
        `Insufficient token balance: have ${balance}, need ${amountIn} for token ${tokenIn} on chain ${chainIdIn}`,
      )
    }

    // Approve tokens for gateway
    let txHash = await walletClient.writeContract({
      abi: erc20Abi,
      account: this.evmPrivateKey ? walletClient.account! : sender,
      address: tokenIn,
      args: [gatewayIn, amountIn],
      chain: chainIn as Chain,
      functionName: "approve",
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 5 })

    // Verify approval was successful with retry logic
    let allowance = 0n
    const maxAllowanceRetries = 3
    for (let i = 0; i < maxAllowanceRetries; i++) {
      allowance = await publicClient.readContract({
        abi: erc20Abi,
        address: tokenIn,
        functionName: "allowance",
        args: [accountAddress, gatewayIn],
      })
      if (allowance >= amountIn) {
        break
      }
      if (i < maxAllowanceRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
    if (allowance < amountIn) {
      throw new Error(`Token approval failed: allowance is ${allowance}, need ${amountIn} for gateway ${gatewayIn}`)
    }

    txHash = await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.evmPrivateKey ? walletClient.account! : sender,
      address: gatewayIn,
      args: [
        {
          fillDeadline,
          orderData: orderDataEncoder.encode(),
          orderDataType: ORDER_DATA_TYPE,
        },
      ],
      chain: chainIn as Chain,
      functionName: "open",
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash! })
    const { orderId, resolvedOrder } = getResolvedOrderAndOrderIdEvmByReceipt(receipt)

    if (secret)
      onSecret?.({
        orderId,
        secret: secret.toString(),
      })
    onOrderOpened?.({
      orderId,
      resolvedOrder,
      transactionHash: txHash,
    })

    await this.#monitorEvmToAztecOrder(order, orderId, callbacks)

    // NOTE: if private
    if (secret) {
      const orderClaimedTxHash = await this.claimEvmToAztecPrivateOrder(orderId, secret.toString())
      onOrderClaimed?.({ orderId, transactionHash: orderClaimedTxHash })
      return {
        orderOpenedTxHash: txHash!,
        orderClaimedTxHash,
        resolvedOrder,
      }
    }

    return {
      orderOpenedTxHash: txHash!,
      resolvedOrder,
    }
  }

  async #refundAztecToEvmOrder(details: RefundOrderDetails): Promise<Hex> {
    const { orderId, chainIdIn, chainIdOut } = details
    const chainOut = this.#getChainByChainId(chainIdOut)
    const { gatewayIn, gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)

    let status = 0
    if (this.azguardClient) {
      const selectedAccount = this.azguardClient.accounts[0]
      const [response] = await this.azguardClient!.execute([
        {
          kind: "simulate_views",
          account: selectedAccount,
          calls: [
            {
              kind: "call",
              contract: gatewayIn,
              method: "get_order_status",
              args: [orderId],
            },
          ],
        },
      ])

      if (response.status === "failed") throw new Error(response.error)
      status = parseInt(BigInt((response as OkResult<SimulateViewsResult>).result.encoded[0][0]).toString())
    } else {
      const wallet = await this.#getAztecWallet()
      const account = await this.#getAztecAccount()
      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayIn), wallet)
      status = parseInt(
        await gateway.methods.get_order_status(Fr.fromString(orderId)).simulate({ from: account.getAddress() }),
      )
    }

    if (status !== OPENED) throw new Error("Cannot find an opened order for the specified order id")
    // NOTE: opened on Aztec -> trigger refund on EVM

    const { walletClient, address } = await this.#getEvmWalletClientAndAddress(chainOut as Chain)
    const log = await this.#getAztecOpenLogByOrderId(orderId)

    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: gatewayOut,
      args: [
        [
          {
            fillDeadline: log?.fillDeadline,
            orderDataType: ORDER_DATA_TYPE,
            orderData: log?.fillInstructions[0].originData,
          },
        ],
      ],
      chain: chainOut as Chain,
      functionName: "refund",
    })
  }

  async #refundEvmToAztecOrder(details: RefundOrderDetails): Promise<Hex> {
    const { orderId, chainIdIn, chainIdOut } = details
    const { gatewayIn, gatewayOut } = this.#getGatewaysByChainIds(chainIdIn, chainIdOut)
    const chainIn = this.#getChainByChainId(chainIdIn)

    const [orderType, orderData] = (await createPublicClient({
      chain: chainIn as Chain,
      transport: http(),
    }).readContract({
      address: gatewayIn,
      abi: l2Gateway7683Abi,
      functionName: "openOrders",
      args: [orderId],
    })) as [Hex, Hex]

    // origin data to send to Aztec gateway refund
    let originDataHex: Hex | undefined = orderData

    // If openOrders does not include the inner originData bytes (sometimes empty), try to recover
    // the origin data from EVM Open event logs as a fallback.
    // Check for empty/invalid hex: "0x", "x", or length <= 2
    if (!originDataHex || originDataHex.length <= 2) {
      const evmPublicClient = createPublicClient({
        chain: chainIn as Chain,
        transport: http(),
      })

      // Fetch Open events for this order ID
      const currentBlock = await evmPublicClient.getBlockNumber()
      const openEvent = l2Gateway7683Abi.find((el) => el.type === "event" && el.name === "Open") as AbiEvent
      const [log] = await evmPublicClient.getLogs({
        address: gatewayIn,
        event: openEvent,
        args: {
          orderId,
        },
        fromBlock: currentBlock - 1000n, // Look back 1000 blocks
        toBlock: currentBlock,
      })

      if (log) {
        const resolvedOrder = parseResolvedOrderEvm(log)
        if (resolvedOrder.fillInstructions?.[0]?.originData) {
          originDataHex = resolvedOrder.fillInstructions[0].originData as Hex
        }
      }
    }

    if (!originDataHex || originDataHex.length <= 2)
      throw new Error("Cannot find an opened order (origin data) for the specified order id")
    // NOTE opened on EVM -> trigger refund on Aztec

    await this.#maybeRegisterAztecGateway()

    if (this.azguardClient) {
      const selectedAccount = this.azguardClient.accounts[0]
      const [response] = await this.azguardClient.execute([
        {
          kind: "send_transaction",
          account: selectedAccount,
          actions: [
            {
              kind: "call",
              contract: gatewayOut,
              method: "refund",
              args: [hexToUintArray(orderId), hexToUintArray(originDataHex as Hex)],
            },
          ],
        },
      ])
      if (response.status === "failed") throw new Error(response.error)
      return (response as OkResult<SendTransactionResult>).result as Hex
    } else {
      const wallet = await this.#getAztecWallet()
      const account = await this.#getAztecAccount()
      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)
      const receipt = await gateway.methods
        .refund(hexToUintArray(orderId), hexToUintArray(originDataHex as Hex))
        .send({
          from: account.getAddress(),
          fee: {
            paymentMethod: await getSponsporedFeePaymentMethod(),
          },
        })
        .wait({
          timeout: AZTEC_WAIT_TIMEOUT,
        })

      return receipt.txHash.toString()
    }
  }
}
