import "dotenv/config"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createLogger } from "@aztec/foundation/log"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { TokenContract, TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { createAztecNodeClient } from "@aztec/aztec.js/node"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getTestWallet, addAccountWithSecretKey } from "./utils.js"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  tokenAddress,
  recipientAddress,
  minPrivateBalance = "1000000000000000000",
  minPublicBalance = "1000000000000000000",
  rpcUrl = process.env.AZTEC_RPC_URL,
] = process.argv

const main = async () => {
  const logger = createLogger("ensure-balance")
  logger.info("Checking balances and minting if needed...")

  const wallet = await getTestWallet(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())

  const minterAccount = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
    paymentMethod,
    deploy: false,
  })

  const targetAddress = AztecAddress.fromString(recipientAddress)
  const tokenAddr = AztecAddress.fromString(tokenAddress)

  logger.info(`Minter account: ${minterAccount.getAddress().toString()}`)
  logger.info(`Target address: ${recipientAddress}`)
  logger.info(`Token address: ${tokenAddress}`)

  const aztecNode = createAztecNodeClient(rpcUrl)
  const tokenInstance = await aztecNode.getContract(tokenAddr)
  if (!tokenInstance) {
    throw new Error(`Token contract not found on Aztec: ${tokenAddress}`)
  }
  await wallet.registerContract(tokenInstance, TokenContractArtifact)
  await wallet.registerSender(targetAddress)

  const token = await TokenContract.at(tokenAddr, wallet)

  logger.info(`Checking current balances...`)
  const currentPublicBalance = await token.methods
    .balance_of_public(targetAddress)
    .simulate({ from: minterAccount.getAddress() })
  const currentPrivateBalance = await token.methods
    .balance_of_private(targetAddress)
    .simulate({ from: minterAccount.getAddress() })

  logger.info(`Current public balance: ${currentPublicBalance}`)
  logger.info(`Current private balance: ${currentPrivateBalance}`)

  const minPrivate = BigInt(minPrivateBalance)
  const minPublic = BigInt(minPublicBalance)

  const privateDeficit = minPrivate > BigInt(currentPrivateBalance) ? minPrivate - BigInt(currentPrivateBalance) : 0n
  const publicDeficit = minPublic > BigInt(currentPublicBalance) ? minPublic - BigInt(currentPublicBalance) : 0n

  if (privateDeficit === 0n && publicDeficit === 0n) {
    logger.info(`✅ Balances are sufficient, no minting needed`)
    return
  }

  logger.info(`Required minimum: private=${minPrivate}, public=${minPublic}`)
  logger.info(`Deficit: private=${privateDeficit}, public=${publicDeficit}`)

  if (privateDeficit > 0n) {
    logger.info(`Minting ${privateDeficit} tokens to private balance...`)
    await token.methods
      .mint_to_private(targetAddress, privateDeficit)
      .send({
        from: minterAccount.getAddress(),
        fee: { paymentMethod },
      })
      .wait({
        timeout: 120000,
      })
    logger.info(`✅ Minted ${privateDeficit} tokens to private balance`)
  }

  if (publicDeficit > 0n) {
    logger.info(`Minting ${publicDeficit} tokens to public balance...`)
    await token.methods
      .mint_to_public(targetAddress, publicDeficit)
      .send({
        from: minterAccount.getAddress(),
        fee: { paymentMethod },
      })
      .wait({
        timeout: 120000,
      })
    logger.info(`✅ Minted ${publicDeficit} tokens to public balance`)
  }

  logger.info(`✅ Balances ensured for ${recipientAddress}`)

  process.exit(0)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
