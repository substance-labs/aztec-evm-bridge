import { AbiEvent, Chain, createPublicClient, erc20Abi, Hex, http, padHex } from "viem"
import * as evmChains from "viem/chains"

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxReceipt } from "@aztec/aztec.js/tx"
import { sleep } from "@aztec/foundation/sleep"
import { AzguardClient } from "@azguardwallet/client"
import { OkResult, SendTransactionResult, SimulateViewsResult } from "@azguardwallet/types"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { AztecAddress } from "@aztec/stdlib/aztec-address"

import {
  getAztecAddressFromAzguardAccount,
  getResolvedOrderByAztecLogs,
  getSponsporedFeePaymentMethod,
  hexToUintArray,
  OrderDataEncoder,
} from "../utils"
import {
  aztecSepolia,
  gatewayAddresses,
  OPENED,
  ORDER_DATA_TYPE,
  PRIVATE_ORDER,
  PRIVATE_ORDER_WITH_HOOK,
  PRIVATE_SENDER,
} from "../constants"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import l2Gateway7683Abi from "../utils/abi/l2Gateway7683"
import type { FillOrderDetails, Order, OrderCallbacks, OrderResult, RefundOrderDetails, ResolvedOrder } from "../types"

const AZTEC_WAIT_TIMEOUT = 120000

export class AztecToEvmOperations {
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
  #getAztecOpenLogByOrderId: (orderId: Hex) => Promise<ResolvedOrder | undefined>

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
    getAztecOpenLogByOrderId: (orderId: Hex) => Promise<ResolvedOrder | undefined>
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
    this.#getAztecOpenLogByOrderId = config.getAztecOpenLogByOrderId
  }

  async openOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const { amountIn, amountOut, chainIdIn, chainIdOut, data, mode, recipient, tokenIn, tokenOut } = order
    const gatewayIn = gatewayAddresses[chainIdIn]
    const gatewayOut = gatewayAddresses[chainIdOut]
    if (!gatewayIn) throw new Error("Unsupported source chain")
    if (!gatewayOut) throw new Error("Unsupported destination chain")

    const fillDeadline = order.fillDeadline ?? 2 ** 32 - 1
    const nonce = Fr.random()
    const isPrivate = mode.includes("private")
    const orderType =
      mode === "private"
        ? PRIVATE_ORDER
        : mode === "privateWithHook"
          ? PRIVATE_ORDER_WITH_HOOK
          : mode === "public"
            ? 1
            : 3

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
      orderType,
      data: data || padHex("0x"),
    }
    await this.#maybeRegisterAztecGateway()

    let orderOpenedReceipt
    if (this.azguardClient) {
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
                method: isPrivate ? "transfer_to_public" : "transfer_in_public",
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
          const receipt = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getTxReceipt(txHash as any)
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
          action: token.methods.transfer_to_public(
            account.getAddress(),
            AztecAddress.fromString(gatewayIn),
            amountIn,
            nonce,
          ),
        } as any)
      } else {
        await (
          await wallet.setPublicAuthWit(
            account.getAddress(),
            {
              caller: AztecAddress.fromString(gatewayIn),
              action: token.methods.transfer_in_public(
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

    const { transactionHash: orderFilledTxHash, resolvedOrder } = await this.monitorOrder(
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

  async fillOrder(details: FillOrderDetails): Promise<string> {
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

    // Approve tokens and wait for confirmation
    const approvalHash = await walletClient.writeContract({
      abi: erc20Abi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: `0x${orderData.outputToken.slice(26)}`,
      args: [gatewayOut, orderData.amountOut],
      chain: chainOut as Chain,
      functionName: "approve",
    })
    await publicClient.waitForTransactionReceipt({
      hash: approvalHash,
      confirmations: 1,
    })

    // Fill the order
    const orderDataEncoder = new OrderDataEncoder(orderData)
    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.evmPrivateKey ? walletClient.account! : address,
      address: gatewayOut,
      args: [orderId, orderDataEncoder.encode(), fillerData],
      chain: chainOut as Chain,
      functionName: "fill",
    })
  }

  async refundOrder(details: RefundOrderDetails): Promise<string> {
    const { orderId, chainIdIn, chainIdOut } = details
    const chainOut = Object.values(evmChains).find((chain: Chain) => chain.id === chainIdOut)
    if (!chainOut) throw new Error("ChainOut not supported")
    const gatewayIn = gatewayAddresses[chainIdIn]
    const gatewayOut = gatewayAddresses[chainIdOut]

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

  async monitorOrder(
    order: Order,
    receipt: TxReceipt,
    callbacks?: OrderCallbacks,
  ): Promise<{ transactionHash: Hex; resolvedOrder: ResolvedOrder }> {
    const { chainIdIn, chainIdOut } = order
    const { onOrderOpened, onOrderFilled } = callbacks || {}
    const chainOut = Object.values(evmChains).find((chain: Chain) => chain.id === chainIdOut)
    if (!chainOut) throw new Error("ChainOut not supported")

    const gatewayIn = gatewayAddresses[chainIdIn]
    const gatewayOut = gatewayAddresses[chainIdOut]

    if (chainIdIn !== aztecSepolia.id) throw new Error("Chain in is not Aztec")
    const { logs } = await createAztecNodeClient(aztecSepolia.rpcUrls.default.http[0]).getPublicLogs({
      fromBlock: receipt.blockNumber! - 1,
      toBlock: receipt.blockNumber! + 1,
      contractAddress: AztecAddress.fromString(gatewayIn),
    })
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
}
