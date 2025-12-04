/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbiEvent, Chain, createClient, createPublicClient, erc20Abi, Hex, http, padHex } from "viem"
import * as evmChains from "viem/chains"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { sleep } from "@aztec/foundation/sleep"
import { poseidon2Hash } from "@aztec/foundation/crypto"
import { AzguardClient } from "@azguardwallet/client"
import { OkResult, SendTransactionResult, SimulateViewsResult } from "@azguardwallet/types"
import { TokenContract, TokenContractArtifact } from "@defi-wonderland/aztec-standards/current/artifacts/Token.js"

import {
  getAztecAddressFromAzguardAccount,
  getResolvedOrderAndOrderIdEvmByReceipt,
  getSponsporedFeePaymentMethod,
  hexToUintArray,
  OrderDataEncoder,
  parseFilledLog,
} from "../utils"
import {
  aztecSepolia,
  FILLED,
  FILLED_PRIVATELY,
  gatewayAddresses,
  ORDER_DATA_TYPE,
  PRIVATE_ORDER,
  PRIVATE_ORDER_WITH_HOOK,
} from "../constants"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import l2Gateway7683Abi from "../utils/abi/l2Gateway7683"

import type {
  FilledLog,
  Order,
  OrderCallbacks,
  OrderData,
  OrderResult,
  FillOrderDetails,
  RefundOrderDetails,
} from "../types"

const AZTEC_WAIT_TIMEOUT = 120000

export class EvmToAztecOperations {
  azguardClient?: AzguardClient
  aztecNodeUrl?: string
  aztecPxeStoreDirectory?: string
  aztecKeySalt?: Hex
  aztecSecretKey?: Hex
  evmPrivateKey?: Hex

  evmProvider?: any

  #getAztecWallet: () => Promise<any>
  #getAztecAccount: () => Promise<any>
  #getEvmWalletClientAndAddress: (chain: Chain) => Promise<{ walletClient: any; address: Hex }>
  #maybeRegisterAztecGateway: () => Promise<void>
  #getAztecFilledLogByOrderId: (orderId: Hex) => Promise<FilledLog | undefined>

  constructor(config: {
    azguardClient?: AzguardClient
    aztecNodeUrl?: string
    aztecPxeStoreDirectory?: string
    aztecKeySalt?: Hex
    aztecSecretKey?: Hex
    evmPrivateKey?: Hex
    evmProvider?: any
    getAztecWallet: () => Promise<any>
    getAztecAccount: () => Promise<any>
    getEvmWalletClientAndAddress: (chain: Chain) => Promise<{ walletClient: any; address: Hex }>
    maybeRegisterAztecGateway: () => Promise<void>
    getAztecFilledLogByOrderId: (orderId: Hex) => Promise<FilledLog | undefined>
  }) {
    this.azguardClient = config.azguardClient
    this.aztecNodeUrl = config.aztecNodeUrl
    this.aztecPxeStoreDirectory = config.aztecPxeStoreDirectory
    this.aztecKeySalt = config.aztecKeySalt
    this.aztecSecretKey = config.aztecSecretKey
    this.evmPrivateKey = config.evmPrivateKey
    this.evmProvider = config.evmProvider

    this.#getAztecWallet = config.getAztecWallet
    this.#getAztecAccount = config.getAztecAccount
    this.#getEvmWalletClientAndAddress = config.getEvmWalletClientAndAddress
    this.#maybeRegisterAztecGateway = config.maybeRegisterAztecGateway
    this.#getAztecFilledLogByOrderId = config.getAztecFilledLogByOrderId
  }

  async openOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const { amountIn, amountOut, chainIdIn, chainIdOut, data, mode, recipient, tokenIn, tokenOut } = order
    const { onSecret, onOrderOpened, onOrderClaimed } = callbacks || {}
    const gatewayIn = gatewayAddresses[chainIdIn]
    const gatewayOut = gatewayAddresses[chainIdOut]
    if (!gatewayIn) throw new Error("Unsupported source chain")
    if (!gatewayOut) throw new Error("Unsupported destination chain")

    const chainIn = Object.values(evmChains).find((chain: Chain) => chain.id === chainIdIn)
    if (!chainIn) throw new Error("ChainIn not supported")
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
      orderType: isPrivate ? PRIVATE_ORDER : 1,
      data: data || padHex("0x"),
    }
    const orderDataEncoder = new OrderDataEncoder(orderData)

    const evmClient = createClient({
      chain: chainIn as Chain,
      transport: http(),
    })
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

    // Register the output token contract with the PXE before monitoring
    if (!this.azguardClient) {
      const wallet = await this.#getAztecWallet()
      const tokenInstance = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getContract(
        AztecAddress.fromString(tokenOut),
      )
      if (!tokenInstance) {
        throw new Error(`Token contract instance not found for address ${tokenOut}`)
      }
      await wallet.registerContract({ instance: tokenInstance, artifact: TokenContractArtifact })
    }

    await this.monitorOrder(order, orderId, callbacks)

    // NOTE: if private
    if (secret) {
      const orderClaimedTxHash = await this.claimPrivateOrder(orderId, secret.toString())
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

  async fillOrder(details: FillOrderDetails): Promise<string> {
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
                      AztecAddress.fromString(gatewayOut),
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
          AztecAddress.fromString(gatewayOut),
          orderData.amountOut,
          orderData.senderNonce,
        ),
      } as any)
    } else {
      await (
        await wallet.setPublicAuthWit(
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

  async refundOrder(details: RefundOrderDetails): Promise<string> {
    const { orderId, chainIdIn, chainIdOut } = details
    const gatewayIn = gatewayAddresses[chainIdIn]
    const gatewayOut = gatewayAddresses[chainIdOut]
    const chainIn = Object.values(evmChains).find((chain: Chain) => chain.id === chainIdIn)
    if (!chainIn) throw new Error("ChainIn not supported")

    const [orderType, orderData] = (await createPublicClient({
      chain: chainIn as Chain,
      transport: http(),
    }).readContract({
      address: gatewayIn,
      abi: l2Gateway7683Abi,
      functionName: "openOrders",
      args: [orderId],
    })) as [Hex, Hex]

    let originDataHex: Hex | undefined = orderData

    // If openOrders does not include the inner originData bytes, recover from EVM Open event logs
    if (!originDataHex || originDataHex.length <= 2) {
      const evmPublicClient = createPublicClient({
        chain: chainIn as Chain,
        transport: http(),
      })

      const currentBlock = await evmPublicClient.getBlockNumber()
      const openEvent = l2Gateway7683Abi.find((el) => el.type === "event" && el.name === "Open") as AbiEvent
      const [log] = await evmPublicClient.getLogs({
        address: gatewayIn,
        event: openEvent,
        args: {
          orderId,
        },
        fromBlock: currentBlock - 1000n,
        toBlock: currentBlock,
      })

      if (log) {
        const { parseResolvedOrderEvm } = await import("../utils")
        const resolvedOrder = parseResolvedOrderEvm(log)
        if (resolvedOrder.fillInstructions?.[0]?.originData) {
          originDataHex = resolvedOrder.fillInstructions[0].originData as Hex
        }
      }
    }

    if (!originDataHex || originDataHex.length <= 2)
      throw new Error("Cannot find an opened order (origin data) for the specified order id")

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

  async claimPrivateOrder(orderId: Hex, secret: Hex): Promise<Hex> {
    const gatewayOut = gatewayAddresses[aztecSepolia.id]
    const log = await this.#getAztecFilledLogByOrderId(orderId)
    if (!log) throw new Error(`Log not found for the specified order id ${orderId}`)
    await this.#maybeRegisterAztecGateway()

    if (this.azguardClient) {
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

    const wallet = await this.#getAztecWallet()
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

  async monitorOrder(order: Order, orderId: Hex, callbacks?: OrderCallbacks): Promise<void> {
    const { chainIdIn, chainIdOut } = order
    const { onOrderFilled } = callbacks || {}
    const gatewayOut = gatewayAddresses[chainIdOut]
    await this.#maybeRegisterAztecGateway()

    if (this.azguardClient) {
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
}
