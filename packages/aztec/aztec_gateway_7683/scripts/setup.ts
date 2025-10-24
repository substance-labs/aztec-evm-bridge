import { Contract, createLogger, EthAddress, Fr, SponsoredFeePaymentMethod } from "@aztec/aztec.js"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

import { getSponsoredFPCInstance } from "./fpc.js"
import { getPXEs, getRandomWallet } from "./utils.js"
import { AztecGateway7683Contract, AztecGateway7683ContractArtifact } from "../src/artifacts/AztecGateway7683.js"

const PORTAL_ADDRESS = EthAddress.ZERO
const L2_CHAIN_ID = 11155420
const DESTINATION_SETTLER_EVM_L2 = EthAddress.ZERO

/**
 * This is used solely for testing purposes, to test the multi-PXE environment.
 */
async function main(): Promise<void> {
  const logger = createLogger("setup")
  const pxes = await getPXEs(["pxe1", "pxe2", "pxe3"])
  const [pxe1, pxe2, pxe3] = pxes
  const sponsoredFPC = await getSponsoredFPCInstance()

  for (const pxe of [pxe1, pxe2, pxe3]) {
    await pxe.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    })
  }

  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)
  const user = await getRandomWallet({ paymentMethod, pxe: pxe1 })
  const filler = await getRandomWallet({ paymentMethod, pxe: pxe2 })
  const deployer = await getRandomWallet({ paymentMethod, pxe: pxe3 })

  await user.registerSender(deployer.getAddress())
  await filler.registerSender(deployer.getAddress())

  const gateway = await AztecGateway7683Contract.deploy(
    deployer,
    DESTINATION_SETTLER_EVM_L2,
    L2_CHAIN_ID,
    PORTAL_ADDRESS,
  )
    .send({
      from: deployer.getAddress(),
      contractAddressSalt: Fr.random(),
      universalDeploy: false,
      skipClassPublication: false,
      skipInstancePublication: false,
      skipInitialization: false,
      fee: { paymentMethod },
    })
    .deployed()

  const token = await Contract.deploy(deployer, TokenContractArtifact, [
    deployer.getAddress(),
    "Wrapped Ethereum",
    "WETH",
    18,
  ])
    .send({
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .deployed()

  // user and filler must know token and gateway
  for (const pxe of [pxe1, pxe2]) {
    await pxe.registerContract({
      instance: token.instance,
      artifact: TokenContractArtifact,
    })
    await pxe.registerContract({
      instance: gateway.instance,
      artifact: AztecGateway7683ContractArtifact,
    })
  }

  const amount = 1000n * 10n ** 18n
  await token
    .withWallet(deployer)
    .methods.mint_to_private(deployer.getAddress(), user.getAddress(), amount)
    .send({
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_private(deployer.getAddress(), filler.getAddress(), amount)
    .send({
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_public(user.getAddress(), amount)
    .send({
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_public(filler.getAddress(), amount)
    .send({
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .wait()

  logger.info(`gateway deployed: ${gateway.address.toString()}`)
  logger.info(`token deployed: ${token.address.toString()}`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
