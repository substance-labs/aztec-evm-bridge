import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createLogger } from "@aztec/foundation/log"
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"

import { getTestWallet, addAccountWithSecretKey } from "./utils.js"

const [, , aztecSecretKey, aztecSalt, tokenAddress, accountAddress, rpcUrl = "https://devnet.aztec-labs.com"] =
  process.argv

const main = async () => {
  const logger = createLogger("check-balance")
  logger.info("Checking token balance...")

  const wallet = await getTestWallet(rpcUrl)

  const account = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
    deploy: false,
  })

  logger.info(`Account: ${account.getAddress().toString()}`)
  logger.info(`Checking address: ${accountAddress}`)
  logger.info(`Token address: ${tokenAddress}`)

  // Register the token contract
  const { createAztecNodeClient } = await import("@aztec/aztec.js/node")
  const aztecNode = createAztecNodeClient(rpcUrl)
  const tokenInstance = await aztecNode.getContract(AztecAddress.fromString(tokenAddress))
  if (!tokenInstance) {
    throw new Error(`Token contract not found on Aztec: ${tokenAddress}`)
  }

  const { TokenContractArtifact } = await import("@defi-wonderland/aztec-standards/artifacts/Token.js")
  await wallet.registerContract({ instance: tokenInstance, artifact: TokenContractArtifact })
  logger.info(`Token contract registered`)

  const token = await TokenContract.at(AztecAddress.fromString(tokenAddress), wallet)
  const targetAddress = AztecAddress.fromString(accountAddress)

  logger.info(`Checking public balance...`)
  const publicBalance = await token.methods.balance_of_public(targetAddress).simulate({ from: account.getAddress() })

  logger.info(`Checking private balance...`)
  const privateBalance = await token.methods.balance_of_private(targetAddress).simulate({ from: account.getAddress() })

  logger.info(`\n📊 Balance Report:`)
  logger.info(`   Token: ${tokenAddress}`)
  logger.info(`   Address: ${accountAddress}`)
  logger.info(`   Public Balance: ${publicBalance}`)
  logger.info(`   Private Balance: ${privateBalance}`)
  logger.info(`   Total Balance: ${BigInt(publicBalance) + BigInt(privateBalance)}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
