// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Chain, createPublicClient, erc20Abi, Hex, http, PublicClient, WalletClient } from "viem"
import { sleep } from "@aztec/foundation/sleep"

/**
 * Check if an account has sufficient token balance
 */
export async function checkTokenBalance(
  publicClient: PublicClient,
  tokenAddress: Hex,
  accountAddress: Hex,
  requiredAmount: bigint,
): Promise<void> {
  const balance = (await publicClient.readContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: "balanceOf",
    args: [accountAddress],
  })) as bigint

  if (balance < requiredAmount) {
    throw new Error(`Insufficient token balance: have ${balance}, need ${requiredAmount} for token ${tokenAddress}`)
  }
}

/**
 * Approve tokens for a gateway with confirmation and retry logic
 */
export async function approveTokens(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: Hex,
  spenderAddress: Hex,
  amount: bigint,
  accountAddress: Hex,
  chain: Chain,
  evmPrivateKey?: Hex,
): Promise<void> {
  // Approve tokens and wait for confirmation
  const approvalHash = await walletClient.writeContract({
    abi: erc20Abi,
    account: evmPrivateKey ? walletClient.account! : accountAddress,
    address: tokenAddress,
    args: [spenderAddress, amount],
    chain,
    functionName: "approve",
  })

  await publicClient.waitForTransactionReceipt({
    hash: approvalHash,
    confirmations: 1,
  })

  // Verify approval succeeded by checking allowance with retries
  const maxRetries = 5
  let allowance = 0n

  for (let i = 0; i < maxRetries; i++) {
    allowance = (await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [accountAddress, spenderAddress],
    })) as bigint

    if (allowance >= amount) {
      return
    }

    // If not enough allowance and not last retry, wait and try again
    if (i < maxRetries - 1) {
      await sleep(2000)
    }
  }

  // Final check - if still not enough allowance, throw error
  throw new Error(
    `Approval failed: allowance is ${allowance}, need ${amount} for spender ${spenderAddress}. Approval tx: ${approvalHash}`,
  )
}

/**
 * Verify token allowance with retry logic
 */
export async function verifyAllowance(
  publicClient: PublicClient,
  tokenAddress: Hex,
  ownerAddress: Hex,
  spenderAddress: Hex,
  requiredAmount: bigint,
  maxRetries: number = 3,
): Promise<void> {
  let allowance = 0n

  for (let i = 0; i < maxRetries; i++) {
    allowance = (await publicClient.readContract({
      abi: erc20Abi,
      address: tokenAddress,
      functionName: "allowance",
      args: [ownerAddress, spenderAddress],
    })) as bigint

    if (allowance >= requiredAmount) {
      return
    }

    if (i < maxRetries - 1) {
      await sleep(5000)
    }
  }

  throw new Error(
    `Token approval verification failed: allowance is ${allowance}, need ${requiredAmount} for spender ${spenderAddress}`,
  )
}
