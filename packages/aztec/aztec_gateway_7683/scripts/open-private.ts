import "dotenv/config"
import { AztecAddress, Contract, createLogger, Fr, SponsoredFeePaymentMethod } from "@aztec/aztec.js"
import { hexToBytes, padHex } from "viem"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getPxe, getWalletFromSecretKey } from "./utils.js"
import { AztecGateway7683ContractArtifact } from "../src/artifacts/AztecGateway7683.js"
import { OrderData } from "../src/ts/test/OrderData.js"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

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
  rpcUrl = "https://aztec-alpha-testnet-fullnode.zkv.xyz",
] = process.argv

async function main(): Promise<void> {
  const logger = createLogger("open-private")
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

  const amountIn = 100n
  const nonce = Fr.random()
  const witness = await wallet.createAuthWit({
    caller: gateway.address,
    action: token.methods.transfer_to_public(wallet.getAddress(), gateway.address, amountIn, nonce),
  })

  const orderData = new OrderData({
    sender: "0x0000000000000000000000000000000000000000000000000000000000000000",
    recipient: padHex(recipientAddress as `0x${string}`),
    inputToken: aztecTokenAddress as `0x${string}`,
    outputToken: padHex(l2EvmTokenAddress as `0x${string}`),
    amountIn,
    amountOut: amountIn,
    senderNonce: nonce.toBigInt(),
    originDomain: 999999, // AZTEC_7683_DOMAIN
    destinationDomain: parseInt(l2Gateway7683Domain),
    destinationSettler: padHex(l2Gateway7683Address as `0x${string}`),
    fillDeadline: 2 ** 32 - 1,
    orderType: 1, // PRIVATE_ORDER
    data: padHex("0x00"),
  })

  const receipt = await gateway.methods
    .open_private({
      fill_deadline: 2 ** 32 - 1,
      order_data: Array.from(hexToBytes(orderData.encode())),
      order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
    })
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

  logger.info(`private order opened: ${receipt.txHash.toString()}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
