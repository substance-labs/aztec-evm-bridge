import { AztecGateway7683Contract } from "../src/artifacts/AztecGateway7683.js"
import { createLogger } from "@aztec/foundation/log"
import { EthAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getTestWallet, addAccountWithSecretKey } from "./utils.js"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  l2Gateway7683Address,
  l2Gateway7683Domain,
  forwarderAddress,
  rpcUrl = "https://devnet.aztec-labs.com",
  deployWallet = "false",
] = process.argv

const main = async () => {
  const logger = createLogger("deploy")
  logger.info("Starting deployment...")

  const wallet = await getTestWallet(rpcUrl)

  logger.info("PXE created")
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  logger.info("Payment method created")

  const account = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
    paymentMethod,
    deploy: deployWallet === "true",
  })
  logger.info("Wallet ready")

  logger.info("Deploying gateway contract...")
  const deployMethod = AztecGateway7683Contract.deploy(
    wallet,
    EthAddress.fromString(l2Gateway7683Address),
    parseInt(l2Gateway7683Domain),
    EthAddress.fromString(forwarderAddress),
  )

  const gateway = await deployMethod
    .send({
      from: account.getAddress(),
      contractAddressSalt: Fr.random(),
      universalDeploy: true,
      fee: { paymentMethod },
    })
    .deployed({
      timeout: 120000,
    })

  logger.info("Gateway deployed, registering...")
  await wallet.registerContract({
    instance: gateway.instance,
    artifact: AztecGateway7683Contract.artifact,
  })

  logger.info(`gateway deployed: ${gateway.address.toString()}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
