import { AbiEvent, Chain, createPublicClient, erc20Abi, Hex, http, padHex } from "viem"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { computeSecretHash } from "@aztec/stdlib/hash"
import { sleep } from "@aztec/foundation/sleep"
import { OkResult, SendTransactionResult, SimulateViewsResult } from "@azguardwallet/types"
import { TokenContract, TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"

import {
  getAztecAddressFromAzguardAccount,
  getResolvedOrderAndOrderIdEvmByReceipt,
  getSponsporedFeePaymentMethod,
  hexToUintArray,
  OrderDataEncoder,
  parseResolvedOrderEvm,
  setPublicAuthWit,
} from "../utils"
import {
  FILLED,
  FILLED_PRIVATELY,
  OPENED,
  ORDER_DATA_TYPE,
  PRIVATE_ORDER,
  PRIVATE_ORDER_WITH_HOOK,
  PUBLIC_ORDER,
} from "../constants"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import l2Gateway7683Abi from "../utils/abi/l2Gateway7683"
import {
  ChainType,
  type FillOrderDetails,
  type Order,
  type OrderCallbacks,
  type OrderData,
  type OrderResult,
  type RefundOrderDetails,
} from "../types"
import { BridgeContext } from "../context/BridgeContext"

const AZTEC_WAIT_TIMEOUT = 120000

export class EvmToAztecOperations {
  constructor(private context: BridgeContext) {}

  async openOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const { amountIn, amountOut, chainIdIn, chainIdOut, data, mode, recipient, tokenIn, tokenOut } = order
    const { onSecret, onOrderOpened, onOrderClaimed } = callbacks || {}
    const { gatewayIn, gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)
    const internalChainIn = this.context.getChainByChainId(chainIdIn)
    if (internalChainIn.type !== ChainType.EVM) throw new Error("ChainIn must be an EVM chain")
    const chainIn = internalChainIn.chain
    const { walletClient, address: sender } = await this.context.getEvmWalletClientAndAddress(chainIn as Chain)

    const fillDeadline = order.fillDeadline ?? 2 ** 32 - 1
    const nonce = Fr.random()
    const isPrivate = mode.includes("private")
    const secret = isPrivate ? Fr.random() : null

    const orderData: OrderData = {
      sender: padHex(sender),
      recipient: secret ? (await computeSecretHash(secret)).toString() : padHex(recipient),
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
    const accountAddress = this.context.evmPrivateKey ? walletClient.account!.address : sender

    // Check token balance
    const balance = (await publicClient.readContract({
      abi: erc20Abi,
      address: tokenIn,
      functionName: "balanceOf",
      args: [accountAddress],
    })) as bigint
    if (balance < amountIn) {
      throw new Error(
        `Insufficient token balance: have ${balance}, need ${amountIn} for token ${tokenIn} on chain ${chainIdIn}`,
      )
    }

    // Approve tokens for gateway
    let txHash = await walletClient.writeContract({
      abi: erc20Abi,
      account: this.context.evmPrivateKey ? walletClient.account! : sender,
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
      allowance = (await publicClient.readContract({
        abi: erc20Abi,
        address: tokenIn,
        functionName: "allowance",
        args: [accountAddress, gatewayIn],
      })) as bigint
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
      account: this.context.evmPrivateKey ? walletClient.account! : sender,
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

    await this.monitorEvmToAztecOrder(order, orderId, callbacks)

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

  async fillOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderId, orderData } = details
    const gatewayOut = this.context.getAztecGatewayAddress()
    const orderType = orderData.orderType
    const isPrivate = orderType === PRIVATE_ORDER || orderType === PRIVATE_ORDER_WITH_HOOK
    const orderDataEncoder = new OrderDataEncoder(orderData)
    await this.context.maybeRegisterAztecGateway()

    if (this.context.azguardClient) {
      const selectedAccount = this.context.azguardClient.accounts[0]
      const fillerData = getAztecAddressFromAzguardAccount(selectedAccount)
      const response = await this.context.azguardClient.execute([
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

    const wallet = await this.context.getAztecWallet()
    const account = await this.context.getAztecAccount()
    const fillerData = account.getAddress().toString()

    const tokenInstance = await createAztecNodeClient(this.context.getAztecRpcUrl()).getContract(
      AztecAddress.fromString(orderData.outputToken),
    )
    if (!tokenInstance) {
      throw new Error(`Token contract instance not found for address ${orderData.outputToken}`)
    }
    await wallet.registerContract(tokenInstance, TokenContractArtifact)
    const [token, aztecGateway] = await Promise.all([
      TokenContract.at(AztecAddress.fromString(orderData.outputToken), wallet),
      AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet),
    ])

    let witness
    if (isPrivate) {
      // Pre-compute the function call and use CallIntent to avoid instanceof check issues
      const action = token.withWallet(wallet).methods.transfer_private_to_public(
        account.getAddress(),
        AztecAddress.fromString(gatewayOut), // NOTE: private orders must be claimed by the user
        orderData.amountOut,
        orderData.senderNonce,
      )
      const call = await action.getFunctionCall()
      witness = await account.createAuthWit({
        caller: AztecAddress.fromString(gatewayOut),
        call,
      } as any)
    } else {
      // Pre-compute the function call and use CallIntent to avoid instanceof check issues
      const action = token
        .withWallet(wallet)
        .methods.transfer_public_to_public(
          account.getAddress(),
          AztecAddress.fromString(orderData.recipient),
          orderData.amountOut,
          orderData.senderNonce,
        )
      const call = await action.getFunctionCall()
      await (
        await setPublicAuthWit(
          wallet,
          account.getAddress(),
          {
            caller: AztecAddress.fromString(gatewayOut),
            call,
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

  async refundOrder(details: RefundOrderDetails): Promise<Hex> {
    const { orderId, chainIdIn, chainIdOut } = details
    const { gatewayIn, gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)
    const internalChainIn = this.context.getChainByChainId(chainIdIn)
    if (internalChainIn.type !== ChainType.EVM) throw new Error("ChainIn must be an EVM chain")
    const chainIn = internalChainIn.chain

    const [orderType, orderData] = (await createPublicClient({
      chain: chainIn,
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

    await this.context.maybeRegisterAztecGateway()

    if (this.context.azguardClient) {
      const selectedAccount = this.context.azguardClient.accounts[0]
      const [response] = await this.context.azguardClient.execute([
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
      const wallet = await this.context.getAztecWallet()
      const account = await this.context.getAztecAccount()
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

  async claimEvmToAztecPrivateOrder(orderId: Hex, secret: Hex): Promise<Hex> {
    const gatewayOut = this.context.getAztecGatewayAddress()
    const log = await this.context.getAztecFilledLogByOrderId(orderId)
    if (!log) throw new Error(`Log not found for the specified order id ${orderId}`)

    // Decode order data to get token address for registration
    const decodedOrder = OrderDataEncoder.decode(log.originData as Hex)

    if (this.context.azguardClient) {
      // NOTE: Azguard currently doesn't expose the actively selected account.
      // Default to accounts[0], assuming it's the connected one.
      const selectedAccount = this.context.azguardClient!.accounts[0]
      const [response] = await this.context.azguardClient!.execute([
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
    const wallet = await this.context.getAztecWallet()
    const tokenAddress = AztecAddress.fromString(decodedOrder.outputToken)
    const tokenInstance = await createAztecNodeClient(this.context.getAztecRpcUrl()).getContract(tokenAddress)

    if (!tokenInstance) {
      throw new Error(`Token contract instance not found for address ${tokenAddress.toString()}`)
    }

    try {
      await wallet.registerContract(tokenInstance, TokenContractArtifact)
    } catch (e) {
      // Token might already be registered, ignore error
      console.warn(`Token contract at ${tokenAddress.toString()} might already be registered.`)
    }

    const account = await this.context.getAztecAccount()
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

  private async monitorEvmToAztecOrder(order: Order, orderId: Hex, callbacks?: OrderCallbacks) {
    const { chainIdIn, chainIdOut } = order
    const { onOrderFilled } = callbacks || {}
    const { gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)
    await this.context.maybeRegisterAztecGateway()

    if (this.context.azguardClient) {
      // NOTE: Azguard currently doesn't expose the actively selected account.
      // Default to accounts[0], assuming it's the connected one.
      const selectedAccount = this.context.azguardClient!.accounts[0]
      while (true) {
        const [response] = await this.context.azguardClient!.execute([
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

    const wallet = await this.context.getAztecWallet!()
    const account = await this.context.getAztecAccount()
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
