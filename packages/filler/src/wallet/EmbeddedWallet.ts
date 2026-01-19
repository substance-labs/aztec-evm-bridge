import { BaseWallet } from "@aztec/wallet-sdk/base-wallet"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Account } from "@aztec/aztec.js/account"
import { AccountManager, type Aliased } from "@aztec/aztec.js/wallet"
import type { PXE } from "@aztec/pxe/client/bundle"
import { type AztecNode } from "@aztec/aztec.js/node"
import { createPXE, getPXEConfig } from "@aztec/pxe/server"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { createStore } from "@aztec/kv-store/lmdb"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import { Fr } from "@aztec/aztec.js/fields"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { SchnorrAccountContract } from "@aztec/accounts/schnorr"
import { TokenContractArtifact, TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import path from "path"

import { config, type AztecChainConfig } from "../config.js"
import { getAztecNode, getSponsoredFPCInstance } from "../utils/aztec.js"
import logger from "../utils/logger.js"
import { AztecGateway7683ContractArtifact } from "../artifacts/AztecGateway7683/AztecGateway7683.js"
import type { AuthWitness } from "@aztec/stdlib/auth-witness"
import {
  getMessageHashFromIntent,
  SetPublicAuthwitContractInteraction,
  type CallIntent,
  type ContractFunctionInteractionCallIntent,
  type IntentInnerHash,
} from "@aztec/aztec.js/authorization"

const initPxe = async (storeName: string, aztecNode: AztecNode): Promise<PXE> => {
  const fullConfig = {
    ...getPXEConfig(),
    l1Contracts: await aztecNode.getL1ContractAddresses(),
    proverEnabled: config.aztec.proverEnabled,
  }

  const dataDirectory = "storePath"
  const storePath = path.join(dataDirectory, storeName)

  // Note: We no longer delete the store on startup to preserve synced notes.
  // Historical private notes cannot be rediscovered once the PXE loses them.
  // If you need a fresh start, manually delete the storePath directory.

  const store = await createStore(storeName, {
    dataDirectory,
    dataStoreMapSizeKb: 1e7,
  })

  return await createPXE(aztecNode, fullConfig, {
    store,
    useLogSuffix: true,
  })
}

export class EmbeddedWallet extends BaseWallet {
  private accounts: Map<string, Account> = new Map()
  public gatewayAddress: AztecAddress
  public tokenAddresses: AztecAddress[]

  private constructor(pxe: PXE, aztecNode: AztecNode, config: AztecChainConfig) {
    super(pxe, aztecNode)
    this.gatewayAddress = AztecAddress.fromString(config.gateway)
    this.tokenAddresses = config.tokens.map((token) => AztecAddress.fromString(token.address))
  }

  static async create(
    config: AztecChainConfig,
    storeName: string,
    useSponsoredFPC: boolean = true,
  ): Promise<EmbeddedWallet> {
    const aztecNode = getAztecNode()
    const pxe = await initPxe(storeName, aztecNode)
    const wallet = new EmbeddedWallet(pxe, aztecNode, config)
    if (useSponsoredFPC) {
      await wallet.registerContract(await getSponsoredFPCInstance(), SponsoredFPCContractArtifact)
    }

    // Add filler account
    await wallet.createAccount()

    // await wallet.registerSender(wallet.gatewayAddress);
    await wallet.registerContractWithoutInstance(wallet.gatewayAddress, AztecGateway7683ContractArtifact)
    logger.info(`[${storeName}] - Registered gateway contract at address ${config.gateway}`)
    for (const token of config.tokens) {
      const tokenAddress = AztecAddress.fromString(token.address)
      await wallet.registerContractWithoutInstance(tokenAddress, TokenContractArtifact)
      logger.info(`[${storeName}] - Registered token contract at address ${token.address}`)
    }

    // Sync private state for all tokens to discover notes minted from other PXEs
    const fillerAddress = wallet.getAddress()
    logger.info(`[${storeName}] - Syncing private state for filler account ${fillerAddress.toString()}...`)
    for (const token of config.tokens) {
      try {
        const tokenAddress = AztecAddress.fromString(token.address)
        const tokenContract = await TokenContract.at(tokenAddress, wallet)
        await tokenContract.methods.sync_private_state().simulate({ from: fillerAddress })
        logger.info(`[${storeName}] - ✓ Synced private state for token ${token.symbol}`)
      } catch (err) {
        logger.warn(`[${storeName}] - Failed to sync private state for token ${token.symbol}:`, err)
      }
    }

    return wallet
  }

  async registerContractWithoutInstance(address: AztecAddress, artifact: ContractArtifact) {
    const contractInstance = await this.aztecNode.getContract(address)

    if (!contractInstance) throw new Error(`Contract instance not found for address ${address.toString()}`)

    await (this.pxe as PXE).registerContract({
      instance: contractInstance,
      artifact,
    })
  }

  async getAccountFromAddress(address: AztecAddress): Promise<Account> {
    const account = this.accounts.get(address.toString())
    if (!account) {
      throw new Error(`Account ${address.toString()} not found in wallet`)
    }
    return account
  }

  async getAccounts(): Promise<Aliased<AztecAddress>[]> {
    return Array.from(this.accounts.keys()).map((address) => ({
      item: AztecAddress.fromString(address),
      alias: "",
    }))
  }

  addAccount(account: Account) {
    this.accounts.set(account.getAddress().toString(), account)
  }

  getAddress(): AztecAddress {
    const account = this.accounts.values().next().value
    if (!account) throw new Error("No accounts in wallet")

    return account.getAddress()
  }

  /**
   * Returns an interaction that can be used to set the authorization status
   * of an intent
   * @param from - The address authorizing/revoking the action
   * @param messageHashOrIntent - The action to authorize/revoke
   * @param authorized - Whether the action can be performed or not
   */
  public setPublicAuthWit(
    from: AztecAddress,
    messageHashOrIntent: Fr | IntentInnerHash | CallIntent | ContractFunctionInteractionCallIntent,
    authorized: boolean,
  ): Promise<SetPublicAuthwitContractInteraction> {
    return SetPublicAuthwitContractInteraction.create(this, from, messageHashOrIntent, authorized)
  }

  /**
   * Creates and returns an authwit according the the rules
   * of the provided account. This authwit can be verified
   * by the account contract
   * @param from - The address authorizing the action
   * @param messageHashOrIntent - The action to authorize
   */
  public override async createAuthWit(
    from: AztecAddress,
    messageHashOrIntent: Fr | IntentInnerHash | CallIntent | ContractFunctionInteractionCallIntent,
  ): Promise<AuthWitness> {
    const account = await this.getAccountFromAddress(from)
    const chainInfo = await this.getChainInfo()
    const messageHash = await getMessageHashFromIntent(messageHashOrIntent, chainInfo)
    return account.createAuthWit(messageHash)
  }

  public getAztecNode(): AztecNode {
    return this.aztecNode
  }

  private async createAccount(): Promise<AccountManager> {
    // TODO: support more account types
    const secret = Fr.fromHexString(config.aztec.secretKey)
    const salt = Fr.fromHexString(config.aztec.salt)
    const signingKey = deriveSigningKey(secret)
    const contract = new SchnorrAccountContract(signingKey)

    const accountManager = await AccountManager.create(this, secret, contract, salt)

    const instance = accountManager.getInstance()
    const artifact = await contract.getContractArtifact()

    await this.registerContract(instance, artifact, secret)

    this.accounts.set(accountManager.address.toString(), await accountManager.getAccount())

    return accountManager
  }
}
