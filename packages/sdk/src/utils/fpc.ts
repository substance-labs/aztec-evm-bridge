import { Fr } from "@aztec/aztec.js/fields"
import { type ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { chainsConfig } from "../constants"

// Canonical Sponsored FPC address on devnet (from https://docs.aztec.network/developers/getting_started_on_devnet)
const CANONICAL_SPONSORED_FPC_ADDRESS = AztecAddress.fromString(
  "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e",
)

export { SponsoredFPCContractArtifact }

export async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
  const node = createAztecNodeClient(chainsConfig.aztecDevnet.chain.rpcUrls.default.http[0])
  const instance = await node.getContract(CANONICAL_SPONSORED_FPC_ADDRESS)
  if (!instance) {
    throw new Error(`Sponsored FPC not found at ${CANONICAL_SPONSORED_FPC_ADDRESS.toString()}`)
  }
  return instance
}

export async function getSponsoredFPCAddress() {
  return CANONICAL_SPONSORED_FPC_ADDRESS
}

export async function getSponsporedFeePaymentMethod() {
  return new SponsoredFeePaymentMethod(CANONICAL_SPONSORED_FPC_ADDRESS)
}
