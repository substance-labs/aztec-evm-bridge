import { createLogger, SponsoredFeePaymentMethod } from "@aztec/aztec.js"
import type { DeployOptions } from "@aztec/aztec.js"
import { TokenContract } from "@aztec/noir-contracts.js/Token"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getPxe, getWalletFromSecretKey } from "./utils.js"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  tokenName,
  tokenSymbol,
  tokenDecimals,
  rpcUrl = "https://aztec-alpha-testnet-fullnode.zkv.xyz",
] = process.argv

const main = async () => {
  const logger = createLogger("deploy-token")
  const pxe = await getPxe(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const wallet = await getWalletFromSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    pxe,
    deploy: false,
  })

  const tokenDeployMethod = TokenContract.deploy(
    wallet,
    wallet.getAddress(),
    tokenName,
    tokenSymbol,
    parseInt(tokenDecimals),
  )
  const deployOptions: DeployOptions = {
    from: wallet.getAddress(),
    fee: { paymentMethod },
  }

  const token = await tokenDeployMethod.send(deployOptions).deployed({
    timeout: 120000,
  })

  await pxe.registerContract({
    instance: token.instance,
    artifact: TokenContract.artifact,
  })

  logger.info(`token deployed: ${token.address.toString()}`)
}

main().catch((err) => {
  console.error("❌", err)
  if (err && err.stack) {
    console.error(err.stack)
  }
  process.exit(1)
})
