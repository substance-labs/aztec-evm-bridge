import { AztecGateway7683Contract } from "../src/artifacts/AztecGateway7683.js"
import { createLogger, EthAddress, Fr, SponsoredFeePaymentMethod } from "@aztec/aztec.js"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getPxe, getWalletFromSecretKey } from "./utils.js"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  l2Gateway7683Address,
  l2Gateway7683Domain,
  forwarderAddress,
  rpcUrl = "https://aztec-alpha-testnet-fullnode.zkv.xyz",
] = process.argv

const main = async () => {
  const logger = createLogger("deploy")
  const pxe = await getPxe(rpcUrl)
  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const wallet = await getWalletFromSecretKey({
    secretKey: aztecSecretKey,
    salt: aztecSalt,
    pxe,
    paymentMethod,
    deploy: false,
  })

  const gateway = await AztecGateway7683Contract.deploy(
    wallet,
    EthAddress.fromString(l2Gateway7683Address),
    parseInt(l2Gateway7683Domain),
    EthAddress.fromString(forwarderAddress),
  )
    .send({
      from: wallet.getAddress(),
      fee: { paymentMethod },
    })
    .deployed({
      timeout: 120000,
    })

  await pxe.registerContract({
    instance: gateway.instance,
    artifact: AztecGateway7683Contract.artifact,
  })

  logger.info(`gateway deployed: ${gateway.address.toString()}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
