import { createAztecNodeClient, PXE, waitForPXE, Fr, FeePaymentMethod, getWallet } from "@aztec/aztec.js"
import { createStore } from "@aztec/kv-store/lmdb"
import { createPXEService, getPXEServiceConfig } from "@aztec/pxe/server"
import { getSchnorrAccount, SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { getSponsoredFPCInstance } from "./fpc.js"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"

export const getPXEs = async (names: string[]): Promise<PXE[]> => {
  const url = "http://localhost:8080"
  const node = createAztecNodeClient(url)

  const fullConfig = {
    ...getPXEServiceConfig(),
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: false,
  }

  const pxes: PXE[] = []
  for (const name of names) {
    const store = await createStore(name, {
      dataDirectory: "store",
      dataStoreMapSizeKB: 1e6,
    })
    const pxe = await createPXEService(node, fullConfig, {
      store,
      useLogSuffix: true,
    })
    await waitForPXE(pxe)
    pxes.push(pxe)
  }
  return pxes
}

export const getNode = (rpcUrl: string) => createAztecNodeClient(rpcUrl)

export const getPxe = async (rpcUrl: string) => {
  const node = getNode(rpcUrl)
  const fullConfig = {
    ...getPXEServiceConfig(),
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: true,
  }
  const store = await createStore(process.env.PXE_STORE_NAME ?? "pxe-testnet", {
    dataDirectory: "store",
    dataStoreMapSizeKB: 1e6,
  })
  const pxe = await createPXEService(node, fullConfig, {
    store,
    useLogSuffix: true,
  })
  await waitForPXE(pxe)

  const fpcContractInstance = await getSponsoredFPCInstance()
  await pxe.registerContract({
    instance: fpcContractInstance,
    artifact: SponsoredFPCContractArtifact,
  })

  return pxe
}

export const getRandomWallet = async ({ paymentMethod, pxe }: { paymentMethod: FeePaymentMethod; pxe: PXE }) => {
  const secretKey = Fr.random()
  const salt = Fr.random()
  const schnorrAccount = await getSchnorrAccount(pxe, secretKey, deriveSigningKey(secretKey), salt)
  await schnorrAccount
    .deploy({
      fee: { paymentMethod },
      skipClassRegistration: false,
      skipPublicDeployment: false,
      skipInitialization: false,
    })
    .wait()
  return await schnorrAccount.getWallet()
}

export const getWalletFromSecretKey = async ({
  paymentMethod,
  pxe,
  secretKey: sk,
  deploy = false,
  salt: s,
}: {
  secretKey: string
  paymentMethod?: FeePaymentMethod
  pxe: PXE
  deploy?: boolean
  salt: string
}) => {
  const salt = Fr.fromHexString(s)
  const secretKey = Fr.fromHexString(sk)
  const signingKey = deriveSigningKey(secretKey)
  const account = await getSchnorrAccount(pxe, secretKey, signingKey, salt)
  if (deploy) {
    if (!paymentMethod) {
      throw new Error("paymentMethod is required when deploy is true")
    }
    await account
      .deploy({
        fee: { paymentMethod },
        skipClassRegistration: false,
        skipPublicDeployment: false,
        skipInitialization: false,
      })
      .wait()
  }
  const wallet = await account.getWallet()
  await pxe.registerAccount(secretKey, (await wallet.getCompleteAddress()).partialAddress)
  await pxe.registerContract({
    instance: account.getInstance(),
    artifact: SchnorrAccountContractArtifact,
  })
  return wallet
}
