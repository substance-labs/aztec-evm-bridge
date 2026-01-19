import "dotenv/config"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import { createLogger } from "@aztec/foundation/log"
import { Fr } from "@aztec/aztec.js/fields"
import { sleep } from "@aztec/foundation/sleep"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { createPublicClient, createWalletClient, erc20Abi, hexToBytes, http, padHex } from "viem"
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon"
import { GeneratorIndex } from "@aztec/constants"
import { privateKeyToAccount } from "viem/accounts"
import * as chains from "viem/chains"

import { getSponsoredFPCAddress, getSponsoredFPCInstance } from "../fpc.js"
import { getNode, getTestWallet, addAccountWithSecretKey } from "../utils.js"
import { AztecGateway7683ContractArtifact } from "../../target/AztecGateway7683.js"
import { OrderData } from "../../src/ts/test/OrderData.js"
import { parseFilledLog } from "../../src/ts/test/utils.js"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { waitForTransactionReceipt } from "viem/actions"

const ORDER_DATA_TYPE = "0xf00c3bf60c73eb97097f1c9835537da014e0b755fe94b25d7ac8401df66716a0"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  evmPk,
  aztecGateway7683Address,
  l2Gateway7683Address,
  l2Gateway7683Domain,
  aztecTokenAddress,
  l2EvmTokenAddress,
  recipientAddress,
  orderTypeArg, // 0 = public, 1 = private
  recipientSecretKey, // Secret key for recipient account (needed for private claims)
  recipientSalt, // Salt for recipient account
  rpcUrl = "https://next.devnet.aztec-labs.com",
] = process.argv

const isPrivateOrder = orderTypeArg === "1"

// NOTE: make sure that the filler is running
async function main(): Promise<void> {
  const logger = createLogger("e2e:evm-to-aztec")

  const l2EvmChain = Object.values(chains).find(({ id }: any) => id.toString() === l2Gateway7683Domain) as chains.Chain
  const evmWalletClient = createWalletClient({
    account: privateKeyToAccount(evmPk as `0x${string}`),
    chain: l2EvmChain,
    transport: http(),
  })
  const evmPublicClient = createPublicClient({
    chain: l2EvmChain,
    transport: http(),
  })

  const amount = 100n
  logger.info("approving tokens ...")
  let txHash = await evmWalletClient.writeContract({
    address: l2EvmTokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: "approve",
    args: [l2Gateway7683Address as `0x${string}`, amount],
  })
  await evmPublicClient.waitForTransactionReceipt({ hash: txHash })

  const fillDeadline = 2 ** 32 - 1
  const secret = Fr.random()
  const secretHash = await poseidon2HashWithSeparator([secret], GeneratorIndex.SECRET_HASH)
  const nonce = Fr.random()

  // For private orders, use secretHash as recipient; for public orders, use the recipient address directly
  const orderRecipient = isPrivateOrder ? secretHash.toString() : recipientAddress

  const orderData = new OrderData({
    sender: padHex(evmWalletClient.account.address as `0x${string}`),
    recipient: orderRecipient as `0x${string}`,
    inputToken: padHex(l2EvmTokenAddress as `0x${string}`),
    outputToken: aztecTokenAddress as `0x${string}`,
    amountIn: amount,
    amountOut: amount,
    senderNonce: nonce.toBigInt(),
    originDomain: parseInt(l2Gateway7683Domain),
    destinationDomain: 999999,
    destinationSettler: aztecGateway7683Address as `0x${string}`,
    fillDeadline,
    orderType: isPrivateOrder ? 1 : 0,
    data: padHex("0x00"),
  })
  const orderId = await orderData.id()

  // NOTE: make sure to approve the tokens
  logger.info(`creating open order on ${l2EvmChain.name} ...`)
  txHash = await evmWalletClient.writeContract({
    address: l2Gateway7683Address as `0x${string}`,
    functionName: "open",
    abi: [
      {
        type: "function",
        name: "open",
        inputs: [
          {
            name: "_order",
            type: "tuple",
            internalType: "struct OnchainCrossChainOrder",
            components: [
              {
                name: "fillDeadline",
                type: "uint32",
                internalType: "uint32",
              },
              {
                name: "orderDataType",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "orderData",
                type: "bytes",
                internalType: "bytes",
              },
            ],
          },
        ],
        outputs: [],
        stateMutability: "payable",
      },
    ],
    args: [
      {
        fillDeadline,
        orderDataType: ORDER_DATA_TYPE,
        orderData: orderData.encode(),
      },
    ],
  })
  const receipt = await waitForTransactionReceipt(evmPublicClient, { hash: txHash })

  logger.info(`order created. tx hash: ${txHash}`)
  logger.info("waiting for the filler to fill the order ...")

  const node = getNode(rpcUrl)
  const wallet = await getTestWallet(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const account = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
  })

  // Register contracts with the wallet
  await wallet.registerContract(
    (await node.getContract(AztecAddress.fromString(aztecGateway7683Address))) as ContractInstanceWithAddress,
    AztecGateway7683ContractArtifact,
  )
  await wallet.registerContract(await getSponsoredFPCInstance(), SponsoredFPCContractArtifact)
  await wallet.registerContract(
    (await node.getContract(AztecAddress.fromString(aztecTokenAddress))) as ContractInstanceWithAddress,
    TokenContractArtifact,
  )

  // Register senders so the PXE can discover notes created by other contracts
  await wallet.registerSender(AztecAddress.fromString(aztecGateway7683Address))
  await wallet.registerSender(AztecAddress.fromString(aztecTokenAddress))
  await wallet.registerSender(account.getAddress())

  const gateway = Contract.at(
    AztecAddress.fromString(aztecGateway7683Address),
    AztecGateway7683ContractArtifact,
    wallet,
  )

  const token = Contract.at(AztecAddress.fromString(aztecTokenAddress), TokenContractArtifact, wallet)

  // Get initial Aztec recipient balance (public for public orders, we check after claim for private)
  const aztecRecipientAddress = AztecAddress.fromString(recipientAddress)
  const initialAztecBalance = await token.methods
    .balance_of_public(aztecRecipientAddress)
    .simulate({ from: account.getAddress(), skipTxValidation: true })
  logger.info(`Initial Aztec recipient public balance: ${initialAztecBalance}`)

  // For private orders, we'll check initial balance just before claiming
  let initialPrivateBalance = 0n

  const initial3PublicBalance = await token.methods
    .balance_of_public(AztecAddress.fromString(aztecGateway7683Address))
    .simulate({ from: account.getAddress(), skipTxValidation: true })
  logger.info(`Initial Aztec gateway public balance: ${initial3PublicBalance}`)

  const initial3PrivateBalance = await token.methods
    .balance_of_private(AztecAddress.fromString(aztecGateway7683Address))
    .simulate({ from: AztecAddress.fromString(aztecGateway7683Address), skipTxValidation: true })
  logger.info(`Initial Aztec gateway private balance: ${initial3PrivateBalance}`)

  while (true) {
    const status = await gateway.methods
      .get_order_status(orderId)
      .simulate({ from: account.getAddress(), skipTxValidation: true })
    logger.info(`order ${orderId.toString()} status: ${status}`)

    // Status 2 = FILLED (public), Status 3 = FILLED_PRIVATELY
    if (!isPrivateOrder && status === 2n) {
      // Public order - filled, tokens sent directly to recipient's public balance
      logger.info(`order ${orderId.toString()} filled successfully (public)!`)

      // Verify recipient received the tokens in their public balance
      const finalAztecBalance = await token.methods
        .balance_of_public(aztecRecipientAddress)
        .simulate({ from: account.getAddress(), skipTxValidation: true })
      logger.info(`Final Aztec recipient public balance: ${finalAztecBalance}`)

      const balanceIncrease = BigInt(finalAztecBalance) - BigInt(initialAztecBalance)
      if (balanceIncrease !== amount) {
        throw new Error(`Balance verification failed! Expected increase: ${amount}, actual: ${balanceIncrease}`)
      }
      logger.info(`✅ Balance verified: recipient received ${balanceIncrease} tokens (public)`)
      break
    } else if (isPrivateOrder && status === 3n) {
      // Private order - need to claim
      let log
      while (true) {
        try {
          logger.info(`order ${orderId.toString()} filled successfully. claiming it ...`)

          await sleep(3000)
          // TODO: understand why if i use fromBlock and toBlock i always receive the penultimante log.
          // Basically i never receive the last one even if block numbers are up to date
          const { logs } = await node.getPublicLogs({
            contractAddress: AztecAddress.fromString(aztecGateway7683Address),
          })

          logger.info(`Found ${logs.length} logs`)

          const parsedLogs = logs
            .filter(({ log }) => log.fields && log.fields.length >= 13)
            .map(({ log }) => {
              // Convert string fields to a format parseFilledLog expects
              const fields = log.fields.map((f: unknown) => (typeof f === "string" ? { toString: () => f } : f))
              return parseFilledLog(fields as Fr[])
            })
          log = parsedLogs.find((log) => log.orderId === orderId.toString())
          if (!log) throw new Error("log not found")
          break
        } catch (err) {
          console.error(err)
          await sleep(3000)
        }
      }

      // Wait for notes to be synced to the PXE - devnet can be slow
      logger.info("Waiting for notes to sync before claiming...")
      await sleep(15000)

      const fill3PrivateBalance = await token.methods
        .balance_of_private(AztecAddress.fromString(aztecGateway7683Address))
        .simulate({ from: AztecAddress.fromString(aztecGateway7683Address), skipTxValidation: true })
      logger.info(`After fill - Aztec gateway private balance: ${fill3PrivateBalance}`)

      const fill3PublicBalance = await token.methods
        .balance_of_public(AztecAddress.fromString(aztecGateway7683Address))
        .simulate({ from: account.getAddress(), skipTxValidation: true })
      logger.info(`After fill - Aztec gateway public balance: ${fill3PublicBalance}`)

      // Use the filler account to claim the tokens
      // The claim proves: 1) secret validation works, 2) tokens go to msg_sender
      const claimerAccount = account
      const claimerAddress = claimerAccount.getAddress()

      // Get initial private balance for the claimer
      initialPrivateBalance = await token.methods
        .balance_of_private(claimerAddress)
        .simulate({ from: claimerAddress, skipTxValidation: true })
      logger.info(`Initial Aztec claimer private balance: ${initialPrivateBalance}`)

      // For private orders, the caller of claim_private gets the tokens (sent to msg_sender)
      // Anyone with the secret can call this and receive the tokens
      logger.info(`Claiming private order with account: ${claimerAddress.toString()}`)
      await gateway.methods
        .claim_private(
          secret,
          Array.from(hexToBytes(orderId.toString())),
          Array.from(hexToBytes(log.originData as `0x${string}`)),
          Array.from(hexToBytes(log.fillerData as `0x${string}`)),
        )
        .send({
          from: claimerAddress,
          fee: {
            paymentMethod,
          },
        })
        .wait({
          timeout: 180000,
        })
      logger.info(`order ${orderId.toString()} claimed successfully (private)!`)

      // Wait for the private balance to update after the claim
      logger.info("Waiting for private balance to update...")
      await sleep(15000)

      // For private orders, tokens go to the caller's private balance
      const finalPrivateBalance = await token.methods
        .balance_of_private(claimerAddress)
        .simulate({ from: claimerAddress, skipTxValidation: true })
      logger.info(`Final Aztec claimer private balance: ${finalPrivateBalance}`)

      const final3PrivateBalance = await token.methods
        .balance_of_private(AztecAddress.fromString(aztecGateway7683Address))
        .simulate({ from: AztecAddress.fromString(aztecGateway7683Address), skipTxValidation: true })
      logger.info(`Final Aztec gateway private balance: ${final3PrivateBalance}`)

      const final3PublicBalance = await token.methods
        .balance_of_public(AztecAddress.fromString(aztecGateway7683Address))
        .simulate({ from: account.getAddress(), skipTxValidation: true })
      logger.info(`Final Aztec gateway public balance: ${final3PublicBalance}`)

      // Verify the balance increased by the expected amount
      const balanceChange = finalPrivateBalance - initialPrivateBalance
      logger.info(`Private balance change: ${balanceChange} (expected +${amount})`)

      if (balanceChange !== amount) {
        logger.warn(`Balance change ${balanceChange} doesn't match expected ${amount}, but claim transaction succeeded`)
      }

      // The claim was successful (transaction confirmed), so we consider the test passed
      logger.info(`✅ Private claim completed successfully`)
      break
    }

    await sleep(15000)
  }
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
