import { padHex } from "viem"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import type { Log } from "viem"
import { Logger } from "winston"

import { getPaymentMethod } from "../utils/aztec.js"
import { AztecGateway7683Contract } from "../artifacts/AztecGateway7683/AztecGateway7683.js"
import {
  AZTEC_7683_CHAIN_ID,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_FILLED_PRIVATELY,
  PRIVATE_ORDER_HEX,
  PUBLIC_ORDER_HEX,
} from "../constants.js"
import { hexToUintArray } from "../utils/bytes.js"
import { getChainConfig, isTokenSupported } from "../config.js"
import type { EmbeddedWallet } from "../wallet/EmbeddedWallet.js"
import type MultiClient from "../MultiClient.js"
import { baseSepolia } from "viem/chains"

export const fillOrderOnAztec = async (
  log: Log,
  aztecWallet: EmbeddedWallet,
  evmMultiClient: MultiClient,
  logger: Logger,
): Promise<{ txHash: string; fillerData: string; orderStatus: string; logArgs: any } | null> => {
  const {
    args: {
      orderId,
      resolvedOrder: { fillInstructions, maxSpent, minReceived },
    },
  } = log as any

  const originData = fillInstructions[0].originData
  const minReceivedAmount = minReceived[0].amount
  const minReceivedToken = minReceived[0].token
  const maxSpentAmount = maxSpent[0].amount
  const maxSpentToken = maxSpent[0].token
  const maxSpentRecipient = maxSpent[0].recipient
  const maxSpentChainId = maxSpent[0].chainId

  if (maxSpentChainId !== AZTEC_7683_CHAIN_ID) throw new Error("Invalid chain id")

  const aztecChainConfig = getChainConfig("aztec")
  if (!aztecChainConfig) throw new Error("Chain config not found")

  // TODO derive originChain
  logger.info(
    `Swapping from X to Aztec ${minReceivedAmount} ${minReceivedToken} for ${maxSpentAmount} ${maxSpentToken} to ${maxSpentRecipient}...`,
  )

  const outputToken = AztecAddress.fromString(maxSpentToken)
  if (!isTokenSupported(aztecChainConfig, maxSpentToken)) {
    throw new Error(`Token ${maxSpentToken} is not supported`)
  }

  const [token, aztecGateway] = await Promise.all([
    TokenContract.at(outputToken, aztecWallet),
    AztecGateway7683Contract.at(AztecAddress.fromString(aztecChainConfig.gateway), aztecWallet),
  ])

  const orderType = `0x${originData.slice(538, 540)}`
  let nextOrderStatus
  if (orderType === PRIVATE_ORDER_HEX) {
    nextOrderStatus = ORDER_STATUS_FILLED_PRIVATELY
  } else if (orderType === PUBLIC_ORDER_HEX) {
    nextOrderStatus = ORDER_STATUS_FILLED
  } else {
    nextOrderStatus = "unknown"
  }
  const fillerEvmAddress = evmMultiClient.getWalletClientByChain(baseSepolia).account?.address //TODO derive from order
  if (!fillerEvmAddress) throw new Error("No EVM filler address found")
  const fillerData = padHex(fillerEvmAddress)

  let receipt
  const paymentMethod = await getPaymentMethod()
  const nonce = Fr.fromHexString(`0x${originData.slice(386, 450)}`)

  const aztecWalletAccountAddress = aztecWallet.getAddress()

  switch (nextOrderStatus) {
    case ORDER_STATUS_FILLED_PRIVATELY: {
      logger.info(`Creating authwit to fill the order ${orderId} ...`)
      const witness = await aztecWallet.createAuthWit(aztecWalletAccountAddress, {
        caller: aztecGateway.address,
        action: token.methods.transfer_private_to_public(
          aztecWalletAccountAddress,
          AztecAddress.fromString(aztecChainConfig.gateway),
          maxSpentAmount,
          nonce,
        ),
      })
      logger.info(`Filling the private order ${orderId} ...`)

      receipt = await aztecGateway.methods
        .fill_private(hexToUintArray(orderId), hexToUintArray(originData), hexToUintArray(fillerData))
        .with({
          authWitnesses: [witness],
        })
        .send({
          from: aztecWalletAccountAddress,
          fee: { paymentMethod },
        })
        .wait({
          timeout: 120000,
        })

      break
    }
    case ORDER_STATUS_FILLED: {
      logger.info(`Setting public authwit to fill the order ${orderId} ...`)
      const recipient = `0x${originData.slice(66, 66 + 64)}`
      await (
        await aztecWallet.setPublicAuthWit(
          aztecWalletAccountAddress,
          {
            caller: AztecAddress.fromString(aztecChainConfig.gateway),
            action: token.methods.transfer_public_to_public(
              aztecWalletAccountAddress,
              AztecAddress.fromString(recipient),
              maxSpentAmount,
              nonce,
            ),
          },
          true,
        )
      )
        .send({ fee: { paymentMethod } })
        .wait({
          timeout: 120000,
        })

      logger.info(`Filling the public order ${orderId} ...`)

      receipt = await aztecGateway.methods
        .fill(hexToUintArray(orderId), hexToUintArray(originData), hexToUintArray(fillerData))
        .send({
          from: aztecWalletAccountAddress,
          fee: { paymentMethod },
        })
        .wait({
          timeout: 120000,
        })

      break
    }
    default: {
      logger.error(`Unknown order status ${nextOrderStatus} for order ${orderId}. Skipping it ...`)
      return null
    }
  }

  logger.info(`Order ${orderId} filled successfully. tx hash: Aztec:${receipt.txHash.toString()}`)

  return {
    txHash: receipt.txHash.toString(),
    fillerData,
    orderStatus: nextOrderStatus,
    logArgs: (log as any).args,
  }
}
