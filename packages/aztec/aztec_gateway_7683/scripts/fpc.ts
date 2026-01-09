import { Fr } from "@aztec/aztec.js/fields"
import { PXE } from "@aztec/pxe/client/bundle"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { type ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { SponsoredFPCContract, SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import type { LogFn } from "@aztec/foundation/log"
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node"

const SPONSORED_FPC_SALT = new Fr(0)

// Canonical Sponsored FPC address on devnet (from https://docs.aztec.network/developers/getting_started_on_devnet)
const CANONICAL_SPONSORED_FPC_ADDRESS = AztecAddress.fromString(
  "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e",
)

export async function getSponsoredFPCInstance(node?: AztecNode): Promise<ContractInstanceWithAddress> {
  // If node is provided, fetch the instance from the network
  if (node) {
    const instance = await node.getContract(CANONICAL_SPONSORED_FPC_ADDRESS)
    if (!instance) {
      throw new Error(`Sponsored FPC not found at ${CANONICAL_SPONSORED_FPC_ADDRESS.toString()}`)
    }
    return instance
  }
  // Otherwise fetch from default devnet node
  const defaultNode = createAztecNodeClient("https://next.devnet.aztec-labs.com")
  const instance = await defaultNode.getContract(CANONICAL_SPONSORED_FPC_ADDRESS)
  if (!instance) {
    throw new Error(`Sponsored FPC not found at ${CANONICAL_SPONSORED_FPC_ADDRESS.toString()}`)
  }
  return instance
}

export async function getSponsoredFPCAddress(): Promise<AztecAddress> {
  // Use the canonical devnet address
  return CANONICAL_SPONSORED_FPC_ADDRESS
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
