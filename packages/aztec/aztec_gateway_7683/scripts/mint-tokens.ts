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
  recipientAddress,
  amountPrivate = "1000000000000000000",
  amountPublic = "1000000000000000000",
  rpcUrl = "https://devnet.aztec-labs.com",
] = process.argv

const main = async () => {
  const logger = createLogger("mint-tokens")
  logger.info("Starting token mint...")

  const wallet = await getTestWallet(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())

  const minterAccount = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
    paymentMethod,
    deploy: false,
  })

  logger.info(`Minter account: ${minterAccount.getAddress().toString()}`)
  logger.info(`Recipient address: ${recipientAddress}`)
  logger.info(`Token address: ${tokenAddress}`)

  const token = await TokenContract.at(AztecAddress.fromString(tokenAddress), wallet)

  if (amountPrivate && BigInt(amountPrivate) > 0n) {
    logger.info(`Minting ${amountPrivate} tokens to private balance...`)
    await token.methods
      .mint_to_private(AztecAddress.fromString(recipientAddress), BigInt(amountPrivate))
      .send({
        from: minterAccount.getAddress(),
        fee: { paymentMethod },
      })
      .wait({
        timeout: 120000,
      })
    logger.info(`✅ Minted ${amountPrivate} tokens to private balance`)
  }

  if (amountPublic && BigInt(amountPublic) > 0n) {
    logger.info(`Minting ${amountPublic} tokens to public balance...`)
    await token.methods
      .mint_to_public(AztecAddress.fromString(recipientAddress), BigInt(amountPublic))
      .send({
        from: minterAccount.getAddress(),
        fee: { paymentMethod },
      })
      .wait({
        timeout: 120000,
      })
    logger.info(`✅ Minted ${amountPublic} tokens to public balance`)
  }

  logger.info(`✅ All tokens successfully minted to ${recipientAddress}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
