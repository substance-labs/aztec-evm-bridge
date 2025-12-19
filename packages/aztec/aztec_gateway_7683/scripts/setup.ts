import { Contract } from "@aztec/aztec.js/contracts"
import { createLogger } from "@aztec/foundation/log"
import { EthAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"

import { getSponsoredFPCInstance } from "./fpc.js"
import { getPXEs, addRandomAccount } from "./utils.js"
import { AztecGateway7683Contract, AztecGateway7683ContractArtifact } from "../src/artifacts/AztecGateway7683.js"
import { TestWallet } from "@aztec/test-wallet/server"

const PORTAL_ADDRESS = EthAddress.ZERO
const L2_CHAIN_ID = 11155420
const DESTINATION_SETTLER_EVM_L2 = EthAddress.ZERO

/**
 * This is used solely for testing purposes, to test the multi-PXE environment.
 */
async function main(): Promise<void> {
  const logger = createLogger("setup")
  const { pxes, node } = await getPXEs(["pxe1", "pxe2", "pxe3"])

  // Create TestWallet instances from the PXEs using the static create method
  const wallet1 = await TestWallet.create(
    node,
    { proverEnabled: false },
    { store: (pxes[0] as any).store, useLogSuffix: true },
  )
  const wallet2 = await TestWallet.create(
    node,
    { proverEnabled: false },
    { store: (pxes[1] as any).store, useLogSuffix: true },
  )
  const wallet3 = await TestWallet.create(
    node,
    { proverEnabled: false },
    { store: (pxes[2] as any).store, useLogSuffix: true },
  )

  const sponsoredFPC = await getSponsoredFPCInstance()

  for (const wallet of [wallet1, wallet2, wallet3]) {
    await wallet.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    })
  }

  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)
  const user = await addRandomAccount({ paymentMethod, testWallet: wallet1 })
  const filler = await addRandomAccount({ paymentMethod, testWallet: wallet2 })
  const deployerAccount = await addRandomAccount({ paymentMethod, testWallet: wallet3 })

  await wallet1.registerSender(deployerAccount.getAddress())
  await wallet2.registerSender(deployerAccount.getAddress())

  const gateway = await AztecGateway7683Contract.deploy(
    wallet3,
    DESTINATION_SETTLER_EVM_L2,
    L2_CHAIN_ID,
    PORTAL_ADDRESS,
  )
    .send({
      from: deployerAccount.getAddress(),
      contractAddressSalt: Fr.random(),
      universalDeploy: false,
      skipClassPublication: false,
      skipInstancePublication: false,
      skipInitialization: false,
      fee: { paymentMethod },
    })
    .deployed()

  const token = await Contract.deploy(wallet3, TokenContractArtifact, [
    "Wrapped Ethereum",
    "WETH",
    18,
    deployerAccount.getAddress(),
    deployerAccount.getAddress(),
  ])
    .send({
      from: deployerAccount.getAddress(),
      fee: { paymentMethod },
    })
    .deployed()

  // user and filler must know token and gateway
  for (const wallet of [wallet1, wallet2]) {
    await wallet.registerContract({
      instance: token.instance,
      artifact: TokenContractArtifact,
    })
    await wallet.registerContract({
      instance: gateway.instance,
      artifact: AztecGateway7683ContractArtifact,
    })
  }

  const amount = 1000n * 10n ** 18n
  await token
    .withWallet(wallet3)
    .methods.mint_to_private(deployerAccount.getAddress(), user.getAddress(), amount)
    .send({
      from: deployerAccount.getAddress(),
      fee: { paymentMethod },
    })
    .wait()
  await token
    .withWallet(wallet3)
    .methods.mint_to_private(deployerAccount.getAddress(), filler.getAddress(), amount)
    .send({
      from: deployerAccount.getAddress(),
      fee: { paymentMethod },
    })
    .wait()
  await token
    .withWallet(wallet3)
    .methods.mint_to_public(user.getAddress(), amount)
    .send({
      from: deployerAccount.getAddress(),
      fee: { paymentMethod },
    })
    .wait()
  await token
    .withWallet(wallet3)
    .methods.mint_to_public(filler.getAddress(), amount)
    .send({
      from: deployerAccount.getAddress(),
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
