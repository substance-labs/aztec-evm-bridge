import { Fr } from "@aztec/aztec.js/fields"
import { PXE } from "@aztec/pxe/client/bundle"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { type ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { SponsoredFPCContract, SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import type { LogFn } from "@aztec/foundation/log"
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"

const SPONSORED_FPC_SALT = new Fr(0)

/**
 * Gets the SponsoredFPC instance by deriving its address from deployment parameters.
 * This works for both local sandbox and devnet as the address is deterministic.
 */
export async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
  const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
    salt: SPONSORED_FPC_SALT,
  })
  return instance
}

export async function getSponsoredFPCAddress(): Promise<AztecAddress> {
  const instance = await getSponsoredFPCInstance()
  return instance.address
}

export async function setupSponsoredFPC(deployer: Wallet, log: LogFn) {
  const deployerAddress = (await deployer.getAccounts())[0].item
  const { contract: deployed } = await SponsoredFPCContract.deploy(deployer)
    .send({
      from: deployerAddress,
      contractAddressSalt: SPONSORED_FPC_SALT,
      universalDeploy: true,
    })
    .wait()

  log(`SponsoredFPC: ${deployed.address}`)
}

export async function getDeployedSponsoredFPCAddress(pxe: PXE) {
  const fpc = await getSponsoredFPCAddress()
  const contracts = await pxe.getContracts()
  if (!contracts.find((c) => c.equals(fpc))) {
    throw new Error("SponsoredFPC not deployed.")
  }
  return fpc
}
