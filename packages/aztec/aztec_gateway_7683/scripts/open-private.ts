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
import { ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"

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

  // Register the token contract
  const tokenInstance = await node.getContract(AztecAddress.fromString(aztecTokenAddress))
  if (!tokenInstance) {
    throw new Error(`Token contract instance not found for address ${aztecTokenAddress}`)
  }

  await wallet.registerContract({
    instance: tokenInstance as ContractInstanceWithAddress,
    artifact: TokenContract.artifact,
  })

  const token = await TokenContract.at(AztecAddress.fromString(aztecTokenAddress), wallet)

  const amountIn = 100n
  const nonce = Fr.random()
  const witness = await account.createAuthWit({
    caller: gateway.address,
    action: token.methods.transfer_private_to_public(account.getAddress(), gateway.address, amountIn, nonce),
  } as any)

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
      from: account.getAddress(),
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
