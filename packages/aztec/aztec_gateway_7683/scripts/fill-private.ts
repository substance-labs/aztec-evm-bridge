import "dotenv/config"
import { AztecAddress, Contract, createLogger, Fr, SponsoredFeePaymentMethod } from "@aztec/aztec.js"
import { hexToBytes, padHex } from "viem"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getPxe, getWalletFromSecretKey } from "./utils.js"
import { AztecGateway7683ContractArtifact } from "../src/artifacts/AztecGateway7683.js"
import { OrderData } from "../src/ts/test/OrderData.js"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { poseidon2Hash } from "@aztec/foundation/crypto"

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
  rpcUrl = "https://aztec-alpha-testnet-fullnode.zkv.xyz",
] = process.argv

async function main(): Promise<void> {
  const logger = createLogger("fill-private")
  const pxe = await getPxe(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const wallet = await getWalletFromSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    pxe,
  })

  await wallet.registerSender(AztecAddress.fromString(aztecGateway7683Address))

  const gateway = await Contract.at(
    AztecAddress.fromString(aztecGateway7683Address),
    AztecGateway7683ContractArtifact,
    wallet,
  )
  const token = await Contract.at(AztecAddress.fromString(aztecTokenAddress), TokenContractArtifact, wallet)

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

  const witness = await wallet.createAuthWit({
    caller: gateway.address,
    action: token.methods.transfer_to_public(wallet.getAddress(), gateway.address, amountOut, nonce),
  })

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
      from: wallet.getAddress(),
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
