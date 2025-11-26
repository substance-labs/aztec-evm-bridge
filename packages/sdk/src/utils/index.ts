import { hexToBytes } from "viem"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import {
  SetPublicAuthwitContractInteraction,
  type CallIntent,
  type ContractFunctionInteractionCallIntent,
  type IntentInnerHash,
} from "@aztec/aztec.js/authorization"
import { Fr } from "@aztec/foundation/fields"

export * from "./beacon"
export * from "./fpc"
export * from "./gateway"
export * from "./order-data-encoder"

export const getAztecAddressFromAzguardAccount = (account: `aztec:${number}:${string}`): `0x:${string}` =>
  account.split(":").slice(-1)[0] as `0x:${string}`

export const hexToUintArray = (str: `0x${string}`) => Array.from(hexToBytes(str))

/**
 * Set a public authorization witness using any wallet instance
 * This is a utility function that works with any wallet implementing the Wallet interface
 */
export async function setPublicAuthWit(
  wallet: Wallet,
  from: AztecAddress,
  messageHashOrIntent: Fr | Buffer | IntentInnerHash | CallIntent | ContractFunctionInteractionCallIntent,
  authorized: boolean,
): Promise<SetPublicAuthwitContractInteraction> {
  return SetPublicAuthwitContractInteraction.create(wallet, from, messageHashOrIntent, authorized)
}
