import "dotenv/config"
import { createLogger } from "@aztec/foundation/log"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { AztecAddress } from "@aztec/aztec.js/addresses"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getTestWallet } from "./utils.js"

const [, , aztecSecretKey, aztecSalt, rpcUrl = "https://next.devnet.aztec-labs.com"] = process.argv

async function main(): Promise<void> {
  const logger = createLogger("deploy:account")

  if (!aztecSecretKey || !aztecSalt) {
    throw new Error("Usage: node deploy-account.ts <secretKey> <salt> [rpcUrl]")
  }

  logger.info(`Deploying account with salt: ${aztecSalt}`)
  logger.info(`Using RPC URL: ${rpcUrl}`)

  const wallet = await getTestWallet(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())

  const salt = Fr.fromHexString(aztecSalt)
  const secretKey = Fr.fromHexString(aztecSecretKey)
  const accountContract = await wallet.createSchnorrAccount(secretKey, salt)
  const account = await accountContract.getAccount()
  const address = account.getAddress()

  logger.info(`Account address: ${address.toString()}`)

  const metadata = await wallet.getContractMetadata(address)
  if (metadata.isContractInitialized) {
    logger.info(`Account is already deployed!`)
    return
  }

  logger.info(`Account not deployed, deploying now...`)
  try {
    const deployMethod = await accountContract.getDeployMethod()
    await deployMethod.send({ from: AztecAddress.ZERO, fee: { paymentMethod } }).wait()
    logger.info(`Account deployed successfully!`)
  } catch (error: any) {
    if (error?.message?.includes("Existing nullifier") || error?.cause?.message?.includes("Existing nullifier")) {
      logger.info(`Account was already deployed (nullifier exists)!`)
      return
    }
    throw error
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
