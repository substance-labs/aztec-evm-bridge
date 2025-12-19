import "dotenv/config"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import { createLogger } from "@aztec/foundation/log"
import { Fr } from "@aztec/aztec.js/fields"
import { sleep } from "@aztec/foundation/sleep"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { createPublicClient, createWalletClient, erc20Abi, hexToBytes, http, padHex } from "viem"
import { poseidon2Hash } from "@aztec/foundation/crypto"
import { privateKeyToAccount } from "viem/accounts"
import * as chains from "viem/chains"

import { getSponsoredFPCAddress, getSponsoredFPCInstance } from "../fpc.js"
import { getNode, getTestWallet, addAccountWithSecretKey } from "../utils.js"
import { AztecGateway7683ContractArtifact } from "../../src/artifacts/AztecGateway7683.js"
import { OrderData } from "../../src/ts/test/OrderData.js"
import { parseFilledLog } from "../../src/ts/test/utils.js"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
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
  rpcUrl = "https://devnet.aztec-labs.com",
] = process.argv

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
  let currentNonce = await evmPublicClient.getTransactionCount({ address: evmWalletClient.account.address })
  let txHash = await evmWalletClient.writeContract({
    address: l2EvmTokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: "approve",
    args: [l2Gateway7683Address as `0x${string}`, amount],
    nonce: currentNonce,
  })
  await evmPublicClient.waitForTransactionReceipt({ hash: txHash })
  currentNonce += 1

  const fillDeadline = 2 ** 32 - 1
  const secret = Fr.random()
  const secretHash = await poseidon2Hash([secret])
  const nonce = Fr.random()
  const orderData = new OrderData({
    sender: padHex(evmWalletClient.account.address as `0x${string}`),
    recipient: secretHash.toString(),
    inputToken: padHex(l2EvmTokenAddress as `0x${string}`),
    outputToken: aztecTokenAddress as `0x${string}`,
    amountIn: amount,
    amountOut: amount,
    senderNonce: nonce.toBigInt(),
    originDomain: parseInt(l2Gateway7683Domain),
    destinationDomain: 999999,
    destinationSettler: aztecGateway7683Address as `0x${string}`,
    fillDeadline,
    orderType: 1, // PRIVATE_ORDER
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
    nonce: currentNonce,
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

  await wallet.registerContract({
    instance: (await node.getContract(AztecAddress.fromString(aztecGateway7683Address))) as ContractInstanceWithAddress,
    artifact: AztecGateway7683ContractArtifact,
  })
  await wallet.registerContract({
    instance: await getSponsoredFPCInstance(),
    artifact: SponsoredFPCContractArtifact,
  })

  const gateway = await Contract.at(
    AztecAddress.fromString(aztecGateway7683Address),
    AztecGateway7683ContractArtifact,
    wallet,
  )

  while (true) {
    const status = await gateway.methods
      .get_order_status(orderId)
      .simulate({ from: account.getAddress(), skipTxValidation: true })
    logger.info(`order ${orderId.toString()} status: ${status}`)
    // FILLED_PRIVATELY
    if (status === 3n) {
      let log
      while (true) {
        try {
          logger.info(`order ${orderId.toString()} filled succesfully. claiming it ...`)

          await sleep(3000)
          // TODO: understand why if i use fromBlock and toBlock i always receive the penultimante log.
          // Basically i never receive the last one even if block numbers are up to date
          const { logs } = await node.getPublicLogs({
            contractAddress: AztecAddress.fromString(aztecGateway7683Address),
          })

          const parsedLogs = logs.map(({ log }) => parseFilledLog(log.fields))
          log = parsedLogs.find((log) => log.orderId === orderId.toString())
          if (!log) throw new Error("log not found")
          break
        } catch (err) {
          console.error(err)
          sleep(3000)
        }
      }

      await gateway.methods
        .claim_private(
          secret,
          Array.from(hexToBytes(orderId.toString())),
          Array.from(hexToBytes(log.originData as `0x${string}`)),
          Array.from(hexToBytes(log.fillerData as `0x${string}`)),
        )
        .send({
          from: account.getAddress(),
          fee: {
            paymentMethod,
          },
        })
        .wait({
          timeout: 120000,
        })
      break
    }

    await sleep(15000)
  }
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
