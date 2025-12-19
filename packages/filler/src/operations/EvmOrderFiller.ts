import { Logger } from "winston"
import { erc20Abi, padHex, sliceHex } from "viem"
import type { PublicClient } from "viem"

import type MultiClient from "../MultiClient.js"
import l2Gateway7683Abi from "../abis/l2Gateway7683.js"
import { ORDER_STATUS_FILLED } from "../constants.js"
import type { ResolvedOrder } from "../types.js"
import { getChainConfig, isEvmChainConfig } from "../config.js"

export const fillOrderOnEvm = async (
  log: ResolvedOrder,
  destinationChainName: string,
  fillerData: `0x${string}`,
  multiClient: MultiClient,
  logger: Logger,
): Promise<{ txHash: string; fillerData: string; orderStatus: string } | null> => {
  const { orderId, fillInstructions, maxSpent, minReceived } = log

  if (!fillInstructions[0]) throw new Error("Invalid fill instructions")
  if (!minReceived[0]) throw new Error("Invalid min received")
  if (!maxSpent[0]) throw new Error("Invalid max spent")

  const chianConfig = getChainConfig(destinationChainName)
  if (!chianConfig) throw new Error("Chain config not found")
  if (!isEvmChainConfig(chianConfig)) throw new Error("Invalid chain config type")

  const { publicClient, walletClient } = multiClient.getClientByChain(chianConfig.chain)
  if (!walletClient.account) throw new Error("Wallet client account address not found")

  const onChainStatus = await publicClient.readContract({
    abi: l2Gateway7683Abi,
    address: chianConfig.gateway,
    functionName: "orderStatus",
    args: [orderId],
  })

  if (onChainStatus !== padHex("0x0")) {
    logger.info(`Order ${orderId} already processed. Skipping it ...`)
    return null
  }

  const { originData } = fillInstructions[0]
  const { amount: minReceivedAmount, token: minReceivedToken } = minReceived[0]
  const {
    amount: maxSpentAmount,
    token: rawMaxSpentToken,
    recipient: maxSpentRecipient,
    chainId: maxSpentChainId,
  } = maxSpent[0]
  const maxSpentToken = rawMaxSpentToken ? sliceHex(rawMaxSpentToken, 12) : ""

  if (maxSpentChainId !== chianConfig.id) throw new Error("Invalid chain id")

  logger.info(
    `Swapping from Aztec to ${chianConfig.name} ${minReceivedAmount} ${minReceivedToken} for ${maxSpentAmount} ${maxSpentToken} to ${maxSpentRecipient}...`,
  )

  const orderStatus = ORDER_STATUS_FILLED

  logger.info(`approving l2EvmGateway to spend ${maxSpentAmount} tokens ...`)

  let txHash = await walletClient.writeContract({
    abi: erc20Abi,
    address: maxSpentToken! as `0x${string}`,
    account: walletClient.account,
    args: [chianConfig.gateway, maxSpentAmount],
    chain: chianConfig.chain,
    functionName: "approve",
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  logger.info(`Tokens approved. ${chianConfig.name}:${txHash}. Verifying allowance ...`)

  await verifyAllowance(
    publicClient,
    maxSpentToken as `0x${string}`,
    walletClient.account.address,
    chianConfig.gateway,
    maxSpentAmount,
    logger,
  )
  logger.info(`Allowance verified. Filling the order ...`)

  // @ts-ignore
  txHash = await walletClient.writeContract({
    abi: l2Gateway7683Abi,
    address: chianConfig.gateway,
    account: walletClient.account,
    args: [orderId, originData, fillerData],
    chain: chianConfig.chain,
    functionName: "fill",
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })

  logger.info(`order ${orderId} filled succesfully. tx hash: ${chianConfig.name}:${txHash}`)

  return { txHash, fillerData, orderStatus }
}

const verifyAllowance = async (
  publicClient: PublicClient,
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  logger: Logger,
) => {
  let allowance = 0n
  let retries = 3
  while (retries > 0) {
    allowance = await publicClient.readContract({
      abi: erc20Abi,
      address: token,
      functionName: "allowance",
      args: [owner, spender],
    })
    if (allowance >= amount) return
    retries--
    if (retries > 0) {
      logger.info(`Allowance not yet updated, retrying... (${retries} attempts left)`)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
  throw new Error(`Token approval failed: allowance is ${allowance}, need ${amount} for gateway ${spender}`)
}
