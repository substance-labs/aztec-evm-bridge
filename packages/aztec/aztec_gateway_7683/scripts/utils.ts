import { AztecNode, createAztecNodeClient } from "@aztec/aztec.js/node"
import { PXE } from "@aztec/pxe/client/bundle"
import { Fr } from "@aztec/aztec.js/fields"
import { FeePaymentMethod } from "@aztec/aztec.js/fee"
import { createStore } from "@aztec/kv-store/lmdb"
import { createPXE, getPXEConfig } from "@aztec/pxe/server"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getSponsoredFPCInstance } from "./fpc.js"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TestWallet } from "@aztec/test-wallet/server"
import { Account, AccountWithSecretKey } from "@aztec/aztec.js/account"

export const getNode = (rpcUrl: string) => createAztecNodeClient(rpcUrl)

export const getPxe = async (rpcUrl: string) => {
  const node = getNode(rpcUrl)
  const fullConfig = {
    ...getPXEConfig(),
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: true,
  }
  const store = await createStore(process.env.PXE_STORE_NAME ?? "pxe-testnet", {
    dataDirectory: "store",
    dataStoreMapSizeKb: 1e6,
  })
  const pxe = await createPXE(node, fullConfig, {
    store,
    useLogSuffix: true,
  })

  const fpcContractInstance = await getSponsoredFPCInstance()
  await pxe.registerContract({ instance: fpcContractInstance, artifact: SponsoredFPCContractArtifact })

  return pxe
}

export const getTestWallet = async (rpcUrl: string, storeName?: string) => {
  const node = getNode(rpcUrl)

  const fullConfig = {
    ...getPXEConfig(),
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: true,
  }

  const store = await createStore(storeName ?? process.env.PXE_STORE_NAME ?? "pxe-testnet", {
    dataDirectory: "store",
    dataStoreMapSizeKb: 1e6,
  })

  const fpcContractInstance = await getSponsoredFPCInstance()

  const wallet = await TestWallet.create(node, fullConfig, { store, useLogSuffix: true })
  await wallet.registerContract(fpcContractInstance, SponsoredFPCContractArtifact)

  return wallet
}

export const addRandomAccount = async ({
  paymentMethod,
  testWallet,
}: {
  paymentMethod: FeePaymentMethod
  testWallet: TestWallet
}): Promise<Account> => {
  const secretKey = Fr.random()
  const salt = Fr.random()
  const accountContract = await testWallet.createSchnorrAccount(secretKey, salt)
  const deployMethod = await accountContract.getDeployMethod()
  await deployMethod.send({ from: AztecAddress.ZERO, fee: { paymentMethod } }).wait()
  return await accountContract.getAccount()
}

export const addAccountWithSecretKey = async ({
  paymentMethod,
  testWallet,
  secretKey: sk,
  deploy = false,
  salt: s,
}: {
  secretKey: string
  paymentMethod?: FeePaymentMethod
  testWallet: TestWallet
  deploy?: boolean
  salt: string
}): Promise<AccountWithSecretKey> => {
  const salt = Fr.fromHexString(s)
  const secretKey = Fr.fromHexString(sk)
  const accountContract = await testWallet.createSchnorrAccount(secretKey, salt)

  if (deploy) {
    if (!paymentMethod) {
      throw new Error("paymentMethod is required when deploy is true")
    }

    // Check if already deployed before attempting deployment
    const account = await accountContract.getAccount()
    const address = account.getAddress()
    const metadata = await testWallet.getContractMetadata(address)

    if (metadata.isContractInitialized) {
      // Already deployed, just return the account
      return account
    }

    const deployMethod = await accountContract.getDeployMethod()
    await deployMethod.send({ from: AztecAddress.ZERO, fee: { paymentMethod } }).wait()
  }
  return await accountContract.getAccount()
}
