import { AztecAddress, createLogger, SponsoredFeePaymentMethod } from "@aztec/aztec.js"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

import { getSponsoredFPCAddress } from "./fpc.js"
import { getNode, getPxe, getWalletFromSecretKey } from "./utils.js"

const [
  ,
  ,
  aztecSecretKey,
  aztecSalt,
  tokenAddress,
  recipientAddress,
  amountPrivate = "1000000000000000000",
  amountPublic = "1000000000000000000",
  rpcUrl = "https://aztec-alpha-testnet-fullnode.zkv.xyz",
] = process.argv

const main = async () => {
  const logger = createLogger("deploy-token")
  const pxe = await getPxe(rpcUrl)

  const paymentMethod = new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())
  const wallet = await getWalletFromSecretKey({
    secretKey: aztecSecretKey as string,
    salt: aztecSalt as string,
    pxe,
    deploy: false,
  })

  const contractInstance = await getNode(rpcUrl).getContract(AztecAddress.fromString(tokenAddress))
  await pxe.registerContract({
    instance: contractInstance!,
    artifact: TokenContractArtifact,
  })

  const token = await TokenContract.at(AztecAddress.fromString(tokenAddress as string), wallet)

  await token.methods
    .mint_to_private(AztecAddress.fromString(recipientAddress), BigInt(amountPrivate))
    .send({
      from: wallet.getAddress(),
      fee: { paymentMethod },
    })
    .wait({
      timeout: 120000,
    })
  /*await token.methods
    .mint_to_public(AztecAddress.fromString(recipientAddress), BigInt(amountPublic))
    .send({
      fee: { paymentMethod },
    })
    .wait()*/

  logger.info(`tokens succesfully minted`)
}

main().catch((err) => {
  console.error(`❌ ${err}`)
  process.exit(1)
})
