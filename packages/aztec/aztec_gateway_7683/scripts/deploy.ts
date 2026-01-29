import "dotenv/config"
import { AztecGateway7683Contract } from "../target/AztecGateway7683.js"
import { createLogger } from "@aztec/foundation/log"
import { EthAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { writeFileSync, mkdirSync } from "fs"

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
  rpcUrl = process.env.AZTEC_RPC_URL,
  deployWallet = "false",
  deployToken = "false",
  tokenName = "Test Token",
  tokenSymbol = "TEST",
  tokenDecimals = "18",
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

  const gatewaySentTx = deployMethod.send({
    from: account.getAddress(),
    contractAddressSalt: Fr.random(),
    universalDeploy: true,
    fee: { paymentMethod },
  })

  const { contract: gateway, instance: gatewayInstance } = await gatewaySentTx.wait({
    timeout: 120000,
  })

  const gatewayTxHash = await gatewaySentTx.getTxHash()

  logger.info("Gateway deployed, registering...")
  await wallet.registerContract(gatewayInstance, AztecGateway7683Contract.artifact)

  logger.info(`gateway deployed: ${gateway.address.toString()}`)

  const deploymentAddresses: Record<string, string> = {
    AztecGateway7683: gateway.address.toString(),
    AztecGatewayDeploymentTx: gatewayTxHash.toString(),
  }

  if (deployToken === "true") {
    logger.info("Deploying token contract...")
    const tokenDeployMethod = TokenContract.deploy(
      wallet,
      tokenName,
      tokenSymbol,
      parseInt(tokenDecimals),
      account.getAddress(),
      account.getAddress(),
    )

    const { contract: token, instance: tokenInstance } = await tokenDeployMethod
      .send({
        from: account.getAddress(),
        fee: { paymentMethod },
      })
      .wait({
        timeout: 120000,
      })

    await wallet.registerContract(tokenInstance, TokenContract.artifact)

    logger.info(`token deployed: ${token.address.toString()}`)
    deploymentAddresses.Token = token.address.toString()
  }

  mkdirSync("deployments", { recursive: true })
  writeFileSync("deployments/deployment.json", JSON.stringify(deploymentAddresses, null, 2))
  logger.info("Deployment addresses saved to deployments/deployment.json")

  // Explicitly exit to close any open handles (PXE connections, etc.)
  process.exit(0)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
