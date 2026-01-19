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
  rpcUrl = "https://next.devnet.aztec-labs.com",
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
  const recipient = AztecAddress.fromString(recipientAddress)
  const minterAddress = minterAccount.getAddress()

  logger.info("Checking initial balances...")
  const initialPublicBalance = await token.methods.balance_of_public(recipient).simulate({ from: minterAddress })
  logger.info(`Initial public balance: ${initialPublicBalance.toString()}`)

  if (amountPrivate && BigInt(amountPrivate) > 0n) {
    logger.info(`Minting ${amountPrivate} tokens to private balance...`)
    await token.methods
      .mint_to_private(recipient, BigInt(amountPrivate))
      .send({
        from: minterAddress,
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
      .mint_to_public(recipient, BigInt(amountPublic))
      .send({
        from: minterAddress,
        fee: { paymentMethod },
      })
      .wait({
        timeout: 120000,
      })
    logger.info(`✅ Minted ${amountPublic} tokens to public balance`)
  }

  logger.info("Checking final balances...")
  const finalPublicBalance = await token.methods.balance_of_public(recipient).simulate({ from: minterAddress })
  const finalPrivateBalance = await token.methods.balance_of_private(recipient).simulate({ from: recipient })
  logger.info(`Final public balance: ${finalPublicBalance.toString()}`)
  logger.info(`Final private balance: ${finalPrivateBalance.toString()}`)

  logger.info(`✅ All tokens successfully minted to ${recipientAddress}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
