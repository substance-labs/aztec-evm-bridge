/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { AccountWithSecretKey } from "@aztec/aztec.js/account"
import { Wallet } from "@aztec/aztec.js/wallet"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { Hex } from "viem"
import { AztecGateway7683Contract } from "../utils/artifacts/AztecGateway7683/AztecGateway7683"
import {
  getSponsoredFPCInstance,
  getSponsporedFeePaymentMethod,
  hexToUintArray,
  OrderDataEncoder,
  setPublicAuthWit,
} from "../utils"
import { aztecSepolia, gatewayAddresses, PRIVATE_ORDER, PRIVATE_ORDER_WITH_HOOK } from "../constants"
import type { FillOrderDetails, OrderData } from "../types"

const AZTEC_WAIT_TIMEOUT = 120000

export class AztecOperations {
  aztecWallet?: Wallet
  #wallet?: Wallet
  #account?: AccountWithSecretKey
  #aztecNodeClient?: ReturnType<typeof createAztecNodeClient>
  #aztecGatewayRegistered = false

  constructor(aztecWallet?: Wallet) {
    this.aztecWallet = aztecWallet
  }

  /**
   * Get the Aztec wallet instance
   */
  async getAztecWallet(): Promise<Wallet> {
    if (!this.#wallet) {
      if (!this.aztecWallet) {
        throw new Error("No Aztec wallet provided. Please provide an aztecWallet in BridgeConfigs.")
      }
      this.#wallet = this.aztecWallet
    }
    return this.#wallet
  }

  /**
   * Get the Aztec account
   */
  async getAztecAccount(): Promise<AccountWithSecretKey> {
    if (!this.#account) {
      const wallet = await this.getAztecWallet()

      // Get the first registered account from the wallet
      const accounts = await wallet.getAccounts()
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts found in the provided wallet. Please register an account with the wallet first.")
      }

      // Get the account from the wallet's internal account management
      const accountAddress = accounts[0].item
      this.#account = (await (wallet as any).getAccountFromAddress(accountAddress)) as AccountWithSecretKey

      if (!this.#account) {
        throw new Error(`Could not retrieve account ${accountAddress.toString()} from wallet`)
      }
    }
    return this.#account!
  }

  /**
   * Get the Aztec node client
   */
  async getAztecNodeClient(): Promise<ReturnType<typeof createAztecNodeClient>> {
    if (!this.#aztecNodeClient) {
      const wallet = await this.getAztecWallet()
      // BaseWallet exposes aztecNode as a protected property
      this.#aztecNodeClient = (wallet as any).aztecNode
      if (!this.#aztecNodeClient) {
        throw new Error("Could not access AztecNode from the provided wallet")
      }
    }
    return this.#aztecNodeClient
  }

  /**
   * Register the Aztec gateway and FPC contracts if not already registered
   */
  async maybeRegisterAztecGateway(): Promise<void> {
    const gateway = gatewayAddresses[aztecSepolia.id]
    if (!this.#aztecGatewayRegistered) {
      const wallet = await this.getAztecWallet()

      // Register the gateway contract
      const instance = await (await this.getAztecNodeClient()).getContract(AztecAddress.fromString(gateway))
      if (!instance) {
        throw new Error(`Contract instance not found for gateway address ${gateway}`)
      }
      await wallet.registerContract({ instance, artifact: AztecGateway7683Contract.artifact })

      // Register the Sponsored FPC contract
      const sponsoredFPC = await getSponsoredFPCInstance()
      await wallet.registerContract({
        instance: sponsoredFPC,
        artifact: SponsoredFPCContractArtifact,
      })

      this.#aztecGatewayRegistered = true
    }
  }

  /**
   * Register a token contract with the wallet
   */
  async registerTokenContract(tokenAddress: Hex): Promise<TokenContract> {
    const wallet = await this.getAztecWallet()
    const tokenInstance = await (await this.getAztecNodeClient()).getContract(AztecAddress.fromString(tokenAddress))

    if (!tokenInstance) {
      throw new Error(`Token contract instance not found for address ${tokenAddress}`)
    }

    await wallet.registerContract({ instance: tokenInstance, artifact: TokenContractArtifact })
    return TokenContract.at(AztecAddress.fromString(tokenAddress), wallet)
  }

  /**
   * Fill an EVM to Aztec order
   */
  async fillEvmToAztecOrder(details: FillOrderDetails): Promise<Hex> {
    const { orderId, orderData } = details
    const chainOut = aztecSepolia
    const gatewayOut = gatewayAddresses[chainOut.id]
    const orderType = orderData.orderType
    const isPrivate = orderType === PRIVATE_ORDER || orderType === PRIVATE_ORDER_WITH_HOOK
    const orderDataEncoder = new OrderDataEncoder(orderData)
    await this.maybeRegisterAztecGateway()

    const wallet = await this.getAztecWallet()
    const account = await this.getAztecAccount()
    const fillerData = account.getAddress().toString()

    // Register and get token contract
    const token = await this.registerTokenContract(orderData.outputToken)
    const aztecGateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)

    // Create auth witness
    let witness
    if (isPrivate) {
      witness = await account.createAuthWit({
        caller: AztecAddress.fromString(gatewayOut),
        action: token.methods.transfer_to_public(
          account.getAddress(),
          AztecAddress.fromString(gatewayOut),
          orderData.amountOut,
          orderData.senderNonce,
        ),
      } as any)
    } else {
      await (
        await setPublicAuthWit(
          wallet,
          account.getAddress(),
          {
            caller: AztecAddress.fromString(gatewayOut),
            action: token.methods.transfer_in_public(
              account.getAddress(),
              AztecAddress.fromString(orderData.recipient),
              orderData.amountOut,
              orderData.senderNonce,
            ),
          },
          true,
        )
      )
        .send({ fee: { paymentMethod: await getSponsporedFeePaymentMethod() } })
        .wait({
          timeout: AZTEC_WAIT_TIMEOUT,
        })
    }

    // Fill the order
    const receipt = await aztecGateway.methods[isPrivate ? "fill_private" : "fill"](
      hexToUintArray(orderId),
      hexToUintArray(orderDataEncoder.encode()),
      hexToUintArray(fillerData),
    )
      .with({
        authWitnesses: witness ? [witness] : [],
      })
      .send({
        from: account.getAddress(),
        fee: { paymentMethod: await getSponsporedFeePaymentMethod() },
      })
      .wait({
        timeout: AZTEC_WAIT_TIMEOUT,
      })

    return receipt.txHash.toString()
  }

  /**
   * Claim a private order filled on Aztec
   */
  async claimPrivateOrder(orderId: Hex, secret: Hex, originData: Hex, fillerData: Hex): Promise<Hex> {
    const gatewayOut = gatewayAddresses[aztecSepolia.id]
    await this.maybeRegisterAztecGateway()

    const wallet = await this.getAztecWallet()
    const account = await this.getAztecAccount()
    const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)

    const receipt = await gateway.methods
      .claim_private(
        Fr.fromString(secret),
        hexToUintArray(orderId),
        hexToUintArray(originData),
        hexToUintArray(fillerData),
      )
      .send({
        from: account.getAddress(),
        fee: { paymentMethod: await getSponsporedFeePaymentMethod() },
      })
      .wait({
        timeout: AZTEC_WAIT_TIMEOUT,
      })

    return receipt.txHash.toString()
  }

  /**
   * Refund an EVM to Aztec order
   */
  async refundEvmToAztecOrder(orderId: Hex, originData: Hex): Promise<Hex> {
    const gatewayOut = gatewayAddresses[aztecSepolia.id]
    await this.maybeRegisterAztecGateway()

    const wallet = await this.getAztecWallet()
    const account = await this.getAztecAccount()
    const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayOut), wallet)

    const receipt = await gateway.methods
      .refund(hexToUintArray(orderId), hexToUintArray(originData))
      .send({
        from: account.getAddress(),
        fee: {
          paymentMethod: await getSponsporedFeePaymentMethod(),
        },
      })
      .wait({
        timeout: AZTEC_WAIT_TIMEOUT,
      })

    return receipt.txHash.toString()
  }

  /**
   * Get order status from Aztec gateway
   */
  async getOrderStatus(orderId: Hex): Promise<number> {
    const gatewayIn = gatewayAddresses[aztecSepolia.id]
    await this.maybeRegisterAztecGateway()

    const wallet = await this.getAztecWallet()
    const account = await this.getAztecAccount()
    const gateway = await AztecGateway7683Contract.at(AztecAddress.fromString(gatewayIn), wallet)

    return parseInt(
      await gateway.methods.get_order_status(Fr.fromString(orderId)).simulate({ from: account.getAddress() }),
    )
  }
}
