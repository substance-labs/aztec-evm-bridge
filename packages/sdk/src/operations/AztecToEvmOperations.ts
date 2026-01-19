import { Chain, createPublicClient, erc20Abi, Hex, http, padHex, AbiEvent } from "viem"
import * as evmChains from "viem/chains"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxHash, TxReceipt } from "@aztec/aztec.js/tx"
import { sleep } from "@aztec/foundation/sleep"
import { OkResult, SendTransactionResult, SimulateViewsResult } from "@azguardwallet/types"
import { TokenContract, TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"

import {
  getAztecAddressFromAzguardAccount,
  getResolvedOrderByAztecLogs,
  getSponsporedFeePaymentMethod,
  hexToUintArray,
  OrderDataEncoder,
  setPublicAuthWit,
} from "../utils"
import {
  ORDER_DATA_TYPE,
  PRIVATE_ORDER,
  PRIVATE_ORDER_WITH_HOOK,
  PRIVATE_SENDER,
  PUBLIC_ORDER,
  PUBLIC_ORDER_WITH_HOOK,
} from "../constants"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import l2Gateway7683Abi from "../utils/abi/l2Gateway7683"
import {
  ChainType,
  type FillOrderDetails,
  type InternalChain,
  type Order,
  type OrderCallbacks,
  type OrderResult,
  type RefundOrderDetails,
  type ResolvedOrder,
} from "../types"
import { BridgeContext } from "../context/BridgeContext"

const AZTEC_WAIT_TIMEOUT = 120000

export class AztecToEvmOperations {
  constructor(private context: BridgeContext) {}

  async openOrder(order: Order, callbacks?: OrderCallbacks): Promise<OrderResult> {
    const { amountIn, amountOut, chainIdIn, chainIdOut, data, mode, recipient, tokenIn, tokenOut } = order
    const { gatewayIn, gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)
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
      orderType: this.getOrderType(mode),
      data: data || padHex("0x"),
    }
    await this.context.maybeRegisterAztecGateway()

    let orderOpenedReceipt
    if (this.context.azguardClient) {
      // NOTE: Azguard currently doesn't expose the actively selected account.
      // Default to using accounts[0], assuming it's the connected one.
      const selectedAccount = this.context.azguardClient!.accounts[0]

      const orderDataEncoder = new OrderDataEncoder({
        ...baseOrderData,
        sender: isPrivate ? PRIVATE_SENDER : getAztecAddressFromAzguardAccount(selectedAccount),
      })
      const response = await this.context.azguardClient!.execute([
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
          const receipt = await createAztecNodeClient(this.context.getAztecRpcUrl()).getTxReceipt(
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
      const wallet = await this.context.getAztecWallet()
      const account = await this.context.getAztecAccount()
      const tokenInstance = await createAztecNodeClient(this.context.getAztecRpcUrl()).getContract(
        AztecAddress.fromString(tokenIn),
      )
      if (!tokenInstance) {
        throw new Error(`Token contract instance not found for address ${tokenIn}`)
      }
      try {
        await wallet.registerContract(tokenInstance, TokenContractArtifact)
      } catch (e) {
        console.warn(`Failed to register token contract at ${tokenIn}: ${e}`)
      }
      const orderDataEncoder = new OrderDataEncoder({
        ...baseOrderData,
        sender: isPrivate ? PRIVATE_SENDER : account.getAddress().toString(),
      })

      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayIn), wallet)
      const token = await TokenContract.at(AztecAddress.fromString(tokenIn), wallet)
      let witness
      if (isPrivate) {
        const action = token
          .withWallet(wallet)
          .methods.transfer_private_to_public(account.getAddress(), AztecAddress.fromString(gatewayIn), amountIn, nonce)
        const call = await action.getFunctionCall()
        witness = await account.createAuthWit({
          caller: AztecAddress.fromString(gatewayIn),
          call,
        } as any)
      } else {
        const action = token
          .withWallet(wallet)
          .methods.transfer_public_to_public(account.getAddress(), AztecAddress.fromString(gatewayIn), amountIn, nonce)
        const call = await action.getFunctionCall()

        await (
          await setPublicAuthWit(
            wallet,
            account.getAddress(),
            {
              caller: AztecAddress.fromString(gatewayIn),
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

    const { transactionHash: orderFilledTxHash, resolvedOrder } = await this.monitorAztecToEvmOrder(
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

  async fillOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderId, orderData } = details
    const internalChainOut = Object.values(this.context.chainsConfig).find(
      (internalChain: InternalChain) => internalChain.chain.id === orderData.destinationDomain,
    )
    if (!internalChainOut) throw new Error("ChainOut not supported")
    if (internalChainOut.type !== ChainType.EVM) throw new Error("ChainOut must be an EVM chain")
    const gatewayOut = internalChainOut.gatewayAddress
    const chainOut = internalChainOut.chain

    const { address, walletClient } = await this.context.getEvmWalletClientAndAddress(chainOut)
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
        account: this.context.evmPrivateKey ? walletClient.account! : address,
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

      // Verify the allowance was set correctly with retries (RPC may have eventual consistency)
      let newAllowance = 0n
      let retries = 3
      while (retries > 0) {
        newAllowance = (await publicClient.readContract({
          abi: erc20Abi,
          address: tokenAddress,
          functionName: "allowance",
          args: [address, gatewayOut],
        })) as bigint
        if (newAllowance >= orderData.amountOut) break
        retries--
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }

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
      account: this.context.evmPrivateKey ? walletClient.account! : address,
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

  async refundOrder(details: RefundOrderDetails): Promise<Hex> {
    const { orderId, chainIdIn, chainIdOut } = details
    const internalChainOut = this.context.getChainByChainId(chainIdOut)
    if (internalChainOut.type !== ChainType.EVM) throw new Error("ChainOut must be an EVM chain")
    const chainOut = internalChainOut.chain
    const { gatewayIn, gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)

    let status = 0
    if (this.context.azguardClient) {
      const selectedAccount = this.context.azguardClient.accounts[0]
      const [response] = await this.context.azguardClient!.execute([
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
      const wallet = await this.context.getAztecWallet()
      const account = await this.context.getAztecAccount()
      const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayIn), wallet)
      status = parseInt(
        await gateway.methods.get_order_status(Fr.fromString(orderId)).simulate({ from: account.getAddress() }),
      )
    }

    const OPENED = 1
    if (status !== OPENED) throw new Error("Cannot find an opened order for the specified order id")

    const { walletClient, address } = await this.context.getEvmWalletClientAndAddress(chainOut as Chain)
    const log = await this.getAztecOpenLogByOrderId(orderId)

    return await walletClient.writeContract({
      abi: l2Gateway7683Abi,
      account: this.context.evmPrivateKey ? walletClient.account! : address,
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

  private async monitorAztecToEvmOrder(
    order: Order,
    receipt: TxReceipt,
    callbacks?: OrderCallbacks,
  ): Promise<{ transactionHash: Hex; resolvedOrder: ResolvedOrder }> {
    const { chainIdIn, chainIdOut } = order
    const { onOrderOpened, onOrderFilled } = callbacks || {}
    const { chainIn: internalChainIn, chainOut: internalChainOut } = this.context.getChainInAndOutByChainIds(
      chainIdIn,
      chainIdOut,
    )
    if (internalChainIn.type !== ChainType.AZTEC) throw new Error("ChainIn must be Aztec")
    if (internalChainOut.type !== ChainType.EVM) throw new Error("ChainOut must be an EVM chain")
    const chainIn = internalChainIn.chain
    const chainOut = internalChainOut.chain
    const { gatewayIn, gatewayOut } = this.context.getGatewaysByChainIds(chainIdIn, chainIdOut)

    const { logs } = await createAztecNodeClient(chainIn.rpcUrls.default.http[0]).getPublicLogs({
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

  private async getAztecOpenLogByOrderId(orderId: Hex): Promise<ResolvedOrder | undefined> {
    const gateway = this.context.getAztecGatewayAddress()
    const { logs } = await createAztecNodeClient(this.context.getAztecRpcUrl()).getPublicLogs({
      contractAddress: AztecAddress.fromString(gateway),
    })
    const parsedOpenLogs = getResolvedOrderByAztecLogs(logs)
    return parsedOpenLogs.find((order) => order.orderId === orderId)
  }

  private getOrderType(mode: Order["mode"]): number {
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
}
