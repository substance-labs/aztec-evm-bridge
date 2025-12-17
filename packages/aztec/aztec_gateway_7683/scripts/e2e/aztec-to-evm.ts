import "dotenv/config"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import { createLogger } from "@aztec/foundation/log"
import { Fr } from "@aztec/aztec.js/fields"
import { sleep } from "@aztec/foundation/sleep"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { createPublicClient, hexToBytes, http, padHex } from "viem"
import * as chains from "viem/chains"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"

import { getSponsoredFPCAddress, getSponsoredFPCInstance } from "../fpc.js"
import { getNode, getTestWallet, addAccountWithSecretKey } from "../utils.js"
import { AztecGateway7683ContractArtifact } from "../../src/artifacts/AztecGateway7683.js"
import { OrderData } from "../../src/ts/test/OrderData.js"

const ORDER_DATA_TYPE = "0xf00c3bf60c73eb97097f1c9835537da014e0b755fe94b25d7ac8401df66716a0"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
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
  const evmClient = createPublicClient({
    chain: l2EvmChain,
    transport: http(),
  })

  const node = getNode(rpcUrl)
  const wallet = await getTestWallet(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const account = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
    deploy: false,
  })

  await wallet.registerContract({
    instance: (await node.getContract(AztecAddress.fromString(aztecGateway7683Address))) as ContractInstanceWithAddress,
    artifact: AztecGateway7683ContractArtifact,
  })
  await wallet.registerContract({
    instance: (await node.getContract(AztecAddress.fromString(aztecTokenAddress))) as ContractInstanceWithAddress,
    artifact: TokenContractArtifact,
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

  const token = await Contract.at(AztecAddress.fromString(aztecTokenAddress), TokenContractArtifact, wallet)

  const fillDeadline = 2 ** 32 - 1
  const amount = 100n
  const nonce = Fr.random()
  const orderData = new OrderData({
    sender: padHex("0x00"),
    recipient: padHex(recipientAddress as `0x${string}`),
    inputToken: aztecTokenAddress as `0x${string}`,
    outputToken: padHex(l2EvmTokenAddress as `0x${string}`),
    amountIn: amount,
    amountOut: amount,
    senderNonce: nonce.toBigInt(),
    originDomain: 999999,
    destinationDomain: parseInt(l2Gateway7683Domain),
    destinationSettler: aztecGateway7683Address as `0x${string}`,
    fillDeadline,
    orderType: 1, // PRIVATE_ORDER
    data: padHex("0x00"),
  })
  const orderId = await orderData.id()

  logger.info("opening private order ...")

  // Create auth witness for private transfer
  const witness = await wallet.createAuthWit(account.getAddress(), {
    caller: gateway.address,
    action: token.methods.transfer_private_to_public(account.getAddress(), gateway.address, amount, nonce),
  })

  const receipt = await gateway.methods
    .open_private({
      fill_deadline: fillDeadline,
      order_data: Array.from(hexToBytes(orderData.encode())),
      order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
    })
    .with({
      authWitnesses: [witness],
    })
    .send({
      from: account.getAddress(),
      fee: { paymentMethod },
    })
    .wait({
      timeout: 120000,
    })

  logger.info(`order opened: ${receipt.txHash.toString()}`)

  while (true) {
    const orderStatus = await evmClient.readContract({
      address: l2Gateway7683Address as `0x${string}`,
      abi: [
        {
          type: "function",
          name: "orderStatus",
          inputs: [
            {
              name: "orderId",
              type: "bytes32",
              internalType: "bytes32",
            },
          ],
          outputs: [
            {
              name: "status",
              type: "bytes32",
              internalType: "bytes32",
            },
          ],
          stateMutability: "view",
        },
      ],
      functionName: "orderStatus",
      args: [orderId.toString()],
    })
    logger.info(`order ${orderId.toString()} status: ${orderStatus}`)

    if (orderStatus !== padHex("0x00")) {
      logger.info("order filled succesfully!")
      break
    }

    await sleep(5000)
  }
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
