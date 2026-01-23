import { Fr } from "@aztec/aztec.js/fields"
import { type ContractInstanceWithAddress } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { defaultChainsConfig } from "../constants"

const CANONICAL_SPONSORED_FPC_ADDRESS = AztecAddress.fromString(
  "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e",
)

export { SponsoredFPCContractArtifact }

export async function getSponsoredFPCInstance(rpcUrl?: string): Promise<ContractInstanceWithAddress> {
  const nodeUrl = rpcUrl ?? defaultChainsConfig.aztecDevnet.chain.rpcUrls.default.http[0]
  const node = createAztecNodeClient(nodeUrl)
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
