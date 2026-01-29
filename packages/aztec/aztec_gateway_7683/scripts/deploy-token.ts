import "dotenv/config"
import { createLogger } from "@aztec/foundation/log"
import type { DeployOptions } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { writeFileSync, mkdirSync } from "fs"
import { getSponsoredFPCAddress } from "./fpc.js"
import { getTestWallet, addAccountWithSecretKey } from "./utils.js"

const [, , aztecSecretKey, aztecSalt, tokenName, tokenSymbol, tokenDecimals, rpcUrl = process.env.AZTEC_RPC_URL] =
  process.argv

const main = async () => {
  const logger = createLogger("deploy-token")
  const wallet = await getTestWallet(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const account = await addAccountWithSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    testWallet: wallet,
    deploy: false,
  })

  const tokenDeployMethod = TokenContract.deployWithOpts(
    {
      wallet: wallet,
      method: "constructor_with_minter",
    },
    tokenName,
    tokenSymbol,
    parseInt(tokenDecimals),
    account.getAddress(),
    account.getAddress(),
  )
  const deployOptions: DeployOptions = {
    from: account.getAddress(),
    fee: { paymentMethod },
  }

  const { contract: token, instance: tokenInstance } = await tokenDeployMethod.send(deployOptions).wait({
    timeout: 120000,
  })

  await wallet.registerContract(tokenInstance, TokenContract.artifact)

  logger.info(`token deployed: ${token.address.toString()}`)

  // Save deployment to file
  mkdirSync("deployments", { recursive: true })
  writeFileSync(
    "deployments/token_deployment.json",
    JSON.stringify(
      {
        Token: token.address.toString(),
      },
      null,
      2,
    ),
  )
  logger.info("Token address saved to deployments/token_deployment.json")

  process.exit(0)
}

main().catch((err) => {
  console.error("❌", err)
  if (err && err.stack) {
    console.error(err.stack)
  }
  process.exit(1)
})
