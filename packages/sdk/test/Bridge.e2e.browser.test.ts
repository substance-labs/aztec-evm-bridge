import { describe, expect, it } from "vitest"
import { baseSepolia } from "viem/chains"
import { Fr } from "@aztec/aztec.js/fields"
import { Hex, isHex, padHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TestWallet } from "@aztec/test-wallet/client/lazy"

import { Bridge, aztecSepolia, type BridgeConfigs } from "../src"
import { getBrowserTestEnv } from "./utils/env"

const env = getBrowserTestEnv()

// Token addresses must match filler config for e2e tests to work
const TOKEN_ON_AZTEC_ADDRESS: `0x${string}` = "0x0e334ca55bc06810c70f9cba8a341d79f3cbb29b8d55eb0f877fc3f463e507f1"
const TOKEN_ON_BASE_ADDRESS: `0x${string}` = "0xF2D41ea5bD5b3A686a2aDB387EbF83913BDAA055"
const DEFAULT_AZTEC_NODE_URL = env.AZTEC_NODE_URL ?? "https://next.devnet.aztec-labs.com"

const REQUIRED_ENV_VARS = ["EVM_PK", "AZTEC_SECRET_KEY", "AZTEC_KEY_SALT"] as const
const missingEnvVar = REQUIRED_ENV_VARS.find((key) => !env[key])
const hasIndexedDB = typeof indexedDB !== "undefined"
const canRunE2E = !missingEnvVar && hasIndexedDB

if (!canRunE2E) {
  const reason = !hasIndexedDB ? "indexedDB is not defined" : `Missing ${missingEnvVar}`
  console.warn(`[browser-e2e] skipping E2E tests: ${reason}`)
}

const describeE2E = canRunE2E ? describe : describe.skip

async function setupBrowserAztecAccount() {
  const aztecNode = createAztecNodeClient(DEFAULT_AZTEC_NODE_URL)

  const secretKey = Fr.fromHexString(env.AZTEC_SECRET_KEY as Hex)
  const salt = Fr.fromHexString(env.AZTEC_KEY_SALT as Hex)
  const testWallet = await TestWallet.create(aztecNode, {
    l1Contracts: await aztecNode.getL1ContractAddresses(),
    proverEnabled: true, // Required for devnet
  })

  // Register the Sponsored FPC contract before creating accounts
  const { getSponsoredFPCInstance, SponsoredFPCContractArtifact } = await import("../src/utils/fpc")
  const sponsoredFPC = await getSponsoredFPCInstance()
  await testWallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact)

  // Create account using TestWallet
  const accountManager = await testWallet.createSchnorrAccount(secretKey, salt)
  const aztecAddress = accountManager.address

  // Register the account sender
  await testWallet.registerSender(aztecAddress)

  // Note: Account deployment is skipped as the account should already be deployed on devnet
  // If not deployed, the first transaction will fail

  return { wallet: testWallet, aztecAddress }
}

/**
 * Bridge E2E Tests (Browser)
 *
 * ⚠️ PREREQUISITES:
 * - Set EVM_PK, AZTEC_SECRET_KEY, AZTEC_KEY_SALT environment variables
 * - Accounts must have WETH on both Base Sepolia and Aztec Sepolia
 * - A filler service must be running
 */
describeE2E("Bridge E2E (browser)", { timeout: 600000 }, () => {
  describe("Base → Aztec", () => {
    it("should open a private order from Base to Aztec", async () => {
      const { wallet, aztecAddress } = await setupBrowserAztecAccount()

      const bridgeConfig: BridgeConfigs = {
        evmPrivateKey: env.EVM_PK as Hex,
        aztecWallet: wallet,
      }

      const bridge = await Bridge.create(bridgeConfig)

      let onSecretCalled = false
      let onOrderOpenedCalled = false
      let onOrderFilledCalled = false
      let onOrderClaimedCalled = false

      const result = await bridge.openOrder(
        {
          chainIdIn: baseSepolia.id,
          chainIdOut: aztecSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: TOKEN_ON_BASE_ADDRESS,
          tokenOut: TOKEN_ON_AZTEC_ADDRESS,
          mode: "private",
          data: padHex("0x"),
          recipient: aztecAddress.toString(),
        },
        {
          onSecret: () => {
            onSecretCalled = true
          },
          onOrderOpened: () => {
            onOrderOpenedCalled = true
          },
          onOrderFilled: () => {
            onOrderFilledCalled = true
          },
          onOrderClaimed: () => {
            onOrderClaimedCalled = true
          },
        },
      )

      expect(isHex(result.orderOpenedTxHash)).toBe(true)
      expect(isHex(result.orderClaimedTxHash)).toBe(true)
      expect(onSecretCalled).toBe(true)
      expect(onOrderOpenedCalled).toBe(true)
      expect(onOrderFilledCalled).toBe(true)
      expect(onOrderClaimedCalled).toBe(true)
    })

    it("should open a public order from Base to Aztec", async () => {
      const { wallet, aztecAddress } = await setupBrowserAztecAccount()

      const bridge = await Bridge.create({
        evmPrivateKey: env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      let onOrderOpenedCalled = false
      let onOrderFilledCalled = false

      const result = await bridge.openOrder(
        {
          chainIdIn: baseSepolia.id,
          chainIdOut: aztecSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: TOKEN_ON_BASE_ADDRESS,
          tokenOut: TOKEN_ON_AZTEC_ADDRESS,
          mode: "public",
          data: padHex("0x"),
          recipient: aztecAddress.toString(),
        },
        {
          onOrderOpened: () => {
            onOrderOpenedCalled = true
          },
          onOrderFilled: () => {
            onOrderFilledCalled = true
          },
        },
      )

      expect(isHex(result.orderOpenedTxHash)).toBe(true)
      expect(onOrderOpenedCalled).toBe(true)
      expect(onOrderFilledCalled).toBe(true)
    })
  })

  describe("Aztec → Base", () => {
    it("should open a public order from Aztec to Base", async () => {
      const { wallet } = await setupBrowserAztecAccount()

      const bridge = await Bridge.create({
        evmPrivateKey: env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      let onOrderOpenedCalled = false
      let onOrderFilledCalled = false

      // Derive EVM address from private key
      const evmAccount = privateKeyToAccount(env.EVM_PK as Hex)
      const evmAddress = evmAccount.address

      const result = await bridge.openOrder(
        {
          chainIdIn: aztecSepolia.id,
          chainIdOut: baseSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: TOKEN_ON_AZTEC_ADDRESS,
          tokenOut: TOKEN_ON_BASE_ADDRESS,
          mode: "public",
          data: padHex("0x"),
          recipient: padHex(evmAddress),
        },
        {
          onOrderOpened: () => {
            onOrderOpenedCalled = true
          },
          onOrderFilled: () => {
            onOrderFilledCalled = true
          },
        },
      )

      expect(isHex(result.orderOpenedTxHash)).toBe(true)
      expect(isHex(result.orderFilledTxHash)).toBe(true)
      expect(onOrderOpenedCalled).toBe(true)
      expect(onOrderFilledCalled).toBe(true)
    })

    it("should open a private order from Aztec to Base", async () => {
      const { wallet } = await setupBrowserAztecAccount()

      const bridge = await Bridge.create({
        evmPrivateKey: env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      // Derive EVM address from private key
      const evmAccount = privateKeyToAccount(env.EVM_PK as Hex)
      const evmAddress = evmAccount.address

      const result = await bridge.openOrder(
        {
          chainIdIn: aztecSepolia.id,
          chainIdOut: baseSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: TOKEN_ON_AZTEC_ADDRESS,
          tokenOut: TOKEN_ON_BASE_ADDRESS,
          mode: "private",
          data: padHex("0x"),
          recipient: padHex(evmAddress),
        },
        {
          onOrderOpened: ({ transactionHash }) => expect(isHex(transactionHash)).toBe(true),
          onOrderFilled: ({ transactionHash }) => expect(isHex(transactionHash)).toBe(true),
        },
      )

      expect(isHex(result.orderOpenedTxHash)).toBe(true)
      expect(isHex(result.orderFilledTxHash)).toBe(true)
    })
  })
})
