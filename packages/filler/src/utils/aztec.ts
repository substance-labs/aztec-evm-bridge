import { createAztecNodeClient, AztecAddress, waitForPXE, Fr, SponsoredFeePaymentMethod } from "@aztec/aztec.js"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { getSchnorrAccount, SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr"
import { SponsoredFPCContract, SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { createPXEService, getPXEServiceConfig } from "@aztec/pxe/server"
import { createStore } from "@aztec/kv-store/lmdb"

import { AztecGateway7683ContractArtifact } from "../artifacts/AztecGateway7683/AztecGateway7683.js"

import type { AztecNode, ContractInstanceWithAddress, PXE, AccountWalletWithSecretKey } from "@aztec/aztec.js"
import type { ResolvedOrder } from "../types.js"

type RegisterContractOptions = {
  artifact: any
}

let pxe: PXE
let accountRegistered = false

export const getAztecWallet = async (): Promise<AccountWalletWithSecretKey> => {
  const pxe = getPxe()
  const secretKey = Fr.fromHexString(process.env.AZTEC_SECRET_KEY as string)
  const salt = Fr.fromHexString(process.env.AZTEC_SALT as string)
  const signingKey = deriveSigningKey(secretKey)
  const account = await getSchnorrAccount(pxe, secretKey, signingKey, salt)
  const wallet = await account.getWallet()

  if (!accountRegistered) {
    await pxe.registerAccount(secretKey, (await account.getCompleteAddress()).partialAddress)
    await pxe.registerContract({
      instance: account.getInstance(),
      artifact: SchnorrAccountContractArtifact,
    })
    accountRegistered = true
  }

  return wallet
}

export const initPxe = async () => {
  const node = await getAztecNode()
  const fullConfig = {
    ...getPXEServiceConfig(),
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: true,
  }
  const store = await createStore("filler-pxe", {
    dataDirectory: "store",
    dataStoreMapSizeKB: 1e6,
  })
  pxe = await createPXEService(node, fullConfig, {
    store,
    useLogSuffix: true,
  })
  await waitForPXE(pxe)
}

export const registerContracts = async ({ aztecGatewayAddress }: { aztecGatewayAddress: string }) => {
  const pxe = getPxe()
  await pxe.registerContract({
    instance: await getSponsoredFPCInstance(),
    artifact: SponsoredFPCContractArtifact,
  })
  await pxe.registerSender(AztecAddress.fromString(aztecGatewayAddress))
  await registerContractWithoutInstance(AztecAddress.fromString(aztecGatewayAddress), {
    artifact: AztecGateway7683ContractArtifact,
  })
}

export const getPxe = () => {
  return pxe
}

export const getAztecNode = async (): Promise<AztecNode> => {
  return await createAztecNodeClient(process.env.AZTEC_RPC_URL || "http://localhost:8080")
}

export const getPaymentMethod = async (): Promise<SponsoredFeePaymentMethod> =>
  new SponsoredFeePaymentMethod(await getSponsoredFPCAddress())

export const registerContractWithoutInstance = async (
  address: AztecAddress,
  { artifact }: RegisterContractOptions,
): Promise<void> => {
  const node = await getAztecNode()
  const contractInstance = await node.getContract(address)
  const pxe = await getPxe()
  await pxe.registerContract({
    instance: contractInstance as ContractInstanceWithAddress,
    artifact,
  })
}

export const parseOpenLog = (log1: Fr[], log2: Fr[]) => {
  let orderId1 = log1[0]!.toString()
  const residualBytes1 = log1[12]!.toString()
  const resolvedOrder1 =
    "0x" +
    log1[1]!.toString().slice(4) +
    residualBytes1.slice(6, 8) +
    log1[2]!.toString().slice(4) +
    residualBytes1.slice(8, 10) +
    log1[3]!.toString().slice(4) +
    residualBytes1.slice(10, 12) +
    log1[4]!.toString().slice(4) +
    residualBytes1.slice(12, 14) +
    log1[5]!.toString().slice(4) +
    residualBytes1.slice(14, 16) +
    log1[6]!.toString().slice(4) +
    residualBytes1.slice(16, 18) +
    log1[7]!.toString().slice(4) +
    residualBytes1.slice(18, 20) +
    log1[8]!.toString().slice(4) +
    residualBytes1.slice(20, 22) +
    log1[9]!.toString().slice(4) +
    residualBytes1.slice(22, 24) +
    log1[10]!.toString().slice(4) +
    residualBytes1.slice(24, 26) +
    log1[11]!.toString().slice(4, 44)

  let orderId2 = log2[0]!.toString()
  const residualBytes2 = log2[10]!.toString()
  const resolvedOrder2 =
    log2[1]!.toString().slice(4) +
    residualBytes2.slice(6, 8) +
    log2[2]!.toString().slice(4) +
    residualBytes2.slice(8, 10) +
    log2[3]!.toString().slice(4) +
    residualBytes2.slice(10, 12) +
    log2[4]!.toString().slice(4) +
    residualBytes2.slice(12, 14) +
    log2[5]!.toString().slice(4) +
    residualBytes2.slice(14, 16) +
    log2[6]!.toString().slice(4) +
    residualBytes2.slice(16, 18) +
    log2[7]!.toString().slice(4) +
    residualBytes2.slice(18, 20) +
    log2[8]!.toString().slice(4) +
    residualBytes2.slice(20, 22) +
    log2[9]!.toString().slice(4, 38)

  orderId1 = "0x" + orderId1.slice(4) + residualBytes1.slice(4, 6)
  orderId2 = "0x" + orderId2.slice(4) + residualBytes2.slice(4, 6)

  if (orderId1 !== orderId2) throw new Error("logs don't belong to the same order")

  return {
    orderId: orderId1,
    resolvedOrder: resolvedOrder1 + resolvedOrder2,
  }
}

export const parseResolvedCrossChainOrder = (resolvedOrder: string): ResolvedOrder => {
  return {
    fillInstructions: [
      {
        originData: `0x${resolvedOrder.slice(resolvedOrder.length - 602)}`,
        destinationSettler: `0x${resolvedOrder.slice(resolvedOrder.length - 666, resolvedOrder.length - 602)}`,
        destinationChainId: parseInt(resolvedOrder.slice(resolvedOrder.length - 674, resolvedOrder.length - 666), 16),
      },
    ],
    maxSpent: [
      {
        chainId: parseInt(resolvedOrder.slice(resolvedOrder.length - 682, resolvedOrder.length - 674), 16),
        recipient: `0x${resolvedOrder.slice(resolvedOrder.length - 746, resolvedOrder.length - 682)}`,
        amount: BigInt("0x" + resolvedOrder.slice(resolvedOrder.length - 810, resolvedOrder.length - 746)),
        token: `0x${resolvedOrder.slice(resolvedOrder.length - 874, resolvedOrder.length - 810)}`,
      },
    ],
    minReceived: [
      {
        chainId: parseInt(resolvedOrder.slice(resolvedOrder.length - 882, resolvedOrder.length - 874), 16),
        recipient: `0x${resolvedOrder.slice(resolvedOrder.length - 946, resolvedOrder.length - 882)}`,
        amount: BigInt("0x" + resolvedOrder.slice(resolvedOrder.length - 1010, resolvedOrder.length - 946)),
        token: `0x${resolvedOrder.slice(resolvedOrder.length - 1074, resolvedOrder.length - 1010)}`,
      },
    ],
    orderId: `0x${resolvedOrder.slice(resolvedOrder.length - 1138, resolvedOrder.length - 1074)}`,
    fillDeadline: parseInt(resolvedOrder.slice(resolvedOrder.length - 1146, resolvedOrder.length - 1138), 16),
    openDeadline: parseInt(resolvedOrder.slice(resolvedOrder.length - 1154, resolvedOrder.length - 1146), 16),
    originChainId: parseInt(resolvedOrder.slice(resolvedOrder.length - 1162, resolvedOrder.length - 1154), 16),
    user: `0x${resolvedOrder.slice(resolvedOrder.length - 1226, resolvedOrder.length - 1162)}`,
  }
}

const SPONSORED_FPC_SALT = new Fr(0)

export async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
  return await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
    salt: SPONSORED_FPC_SALT,
  })
}

export async function getSponsoredFPCAddress() {
  return (await getSponsoredFPCInstance()).address
}

export async function getDeployedSponsoredFPCAddress(pxe: PXE) {
  const fpc = await getSponsoredFPCAddress()
  const contracts = await pxe.getContracts()
  if (!contracts.find((c) => c.equals(fpc))) {
    throw new Error("SponsoredFPC not deployed.")
  }
  return fpc
}
