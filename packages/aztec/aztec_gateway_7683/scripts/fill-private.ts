import "dotenv/config"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createLogger } from "@aztec/foundation/log"
import { Fr } from "@aztec/aztec.js/fields"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { hexToBytes, padHex } from "viem"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getTestWallet, addAccountWithSecretKey, getNode } from "./utils.js"
import { AztecGateway7683Contract } from "../src/artifacts/AztecGateway7683.js"
import { OrderData } from "../src/ts/test/OrderData.js"
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { poseidon2Hash } from "@aztec/foundation/crypto"
import { ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  aztecGateway7683Address,
  aztecTokenAddress,
  l2EvmTokenAddress,
  l2Gateway7683Domain,
  fillerAddress,
  rpcUrl = "https://devnet.aztec-labs.com",
] = process.argv

async function main(): Promise<void> {
  const logger = createLogger("fill-private")
  const wallet = await getTestWallet(rpcUrl)
  const node = getNode(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const account = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
  })

  // Register the gateway contract
  const gatewayInstance = await node.getContract(AztecAddress.fromString(aztecGateway7683Address))
  if (!gatewayInstance) {
    throw new Error(`Gateway contract instance not found for address ${aztecGateway7683Address}`)
  }

  await wallet.registerContract({
    instance: gatewayInstance as ContractInstanceWithAddress,
    artifact: AztecGateway7683Contract.artifact,
  })

  const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(aztecGateway7683Address), wallet)

  // Register the token contract by fetching instance from node
  const tokenInstance = await node.getContract(AztecAddress.fromString(aztecTokenAddress))
  if (!tokenInstance) {
    throw new Error(`Token contract instance not found for address ${aztecTokenAddress}`)
  }

  await wallet.registerContract({
    instance: tokenInstance as ContractInstanceWithAddress,
    artifact: TokenContract.artifact,
  })

  const token = await TokenContract.at(AztecAddress.fromString(aztecTokenAddress), wallet)

  const amountOut = 100n
  const nonce = Fr.random()
  const secret = Fr.random()
  const secretHash = await poseidon2Hash([secret])

  const orderData = new OrderData({
    sender: "0x0000000000000000000000000000000000000000000000000000000000000000",
    recipient: secretHash.toString(),
    inputToken: padHex(l2EvmTokenAddress as `0x${string}`),
    outputToken: aztecTokenAddress as `0x${string}`,
    amountIn: amountOut,
    amountOut,
    senderNonce: nonce.toBigInt(),
    originDomain: parseInt(l2Gateway7683Domain),
    destinationDomain: 999999, // AZTEC_7683_DOMAIN
    destinationSettler: gateway.address.toString(),
    fillDeadline: 2 ** 32 - 1,
    orderType: 1, // PRIVATE_ORDER
    data: padHex("0x00"),
  })

  const orderId = await orderData.id()

  console.log(`Filling order with ID: ${orderId.toString()}`)

  const witness = await account.createAuthWit({
    caller: gateway.address,
    action: token.methods.transfer_private_to_public(account.getAddress(), gateway.address, amountOut, nonce),
  } as any)

  console.log(`Witness created for filling order ID: ${orderId.toString()}`)

  const receipt = await gateway.methods
    .fill_private(
      Array.from(hexToBytes(orderId.toString())),
      Array.from(hexToBytes(orderData.encode())),
      Array.from(hexToBytes(padHex(fillerAddress as `0x${string}`))),
    )
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

  logger.info(`order filled: ${receipt.txHash.toString()}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
