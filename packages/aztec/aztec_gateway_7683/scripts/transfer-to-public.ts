import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createLogger } from "@aztec/foundation/log"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getTestWallet, addAccountWithSecretKey } from "./utils.js"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  tokenAddress,
  amount = "10000000000000000000", // 10 tokens by default
  rpcUrl = "https://devnet.aztec-labs.com",
] = process.argv

const main = async () => {
  const logger = createLogger("transfer-to-public")
  logger.info("Transferring tokens from private to public balance...")

  const wallet = await getTestWallet(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())

  const account = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
    paymentMethod,
    deploy: false,
  })

  logger.info(`Account: ${account.getAddress().toString()}`)
  logger.info(`Token address: ${tokenAddress}`)
  logger.info(`Amount to transfer: ${amount}`)

  const token = await TokenContract.at(AztecAddress.fromString(tokenAddress), wallet)

  logger.info(`Transferring ${amount} tokens from private to public...`)
  await token.methods
    .transfer_private_to_public(account.getAddress(), account.getAddress(), BigInt(amount), 0n)
    .send({
      from: account.getAddress(),
      fee: { paymentMethod },
    })
    .wait({
      timeout: 120000,
    })

  logger.info(`✅ ${amount} tokens successfully transferred to public balance`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
