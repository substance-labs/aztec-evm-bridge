import { Fr } from "@aztec/aztec.js/fields"
import { PXE } from "@aztec/pxe/client/bundle"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams, type ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { SponsoredFPCContract, SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import type { LogFn } from "@aztec/foundation/log"

const SPONSORED_FPC_SALT = new Fr(0)

export async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
  return await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, { salt: SPONSORED_FPC_SALT })
}

export async function getSponsoredFPCAddress(): Promise<AztecAddress> {
  const fpcInstance = await getSponsoredFPCInstance()
  return fpcInstance.address
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
