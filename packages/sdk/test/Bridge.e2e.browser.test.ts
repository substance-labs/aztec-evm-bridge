import { describe, expect, it } from "vitest"
import { baseSepolia } from "viem/chains"
import { Fr } from "@aztec/aztec.js/fields"
import { Hex, isHex, padHex } from "viem"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TestWallet } from "@aztec/test-wallet/client/lazy"

import { Bridge, aztecSepolia, type BridgeConfigs } from "../src"
import { getBrowserTestEnv } from "./utils/env"

const env = getBrowserTestEnv()

const WETH_ON_AZTEC_SEPOLIA_ADDRESS: `0x${string}` =
  "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
const WETH_ON_BASE_SEPOLIA_ADDRESS: `0x${string}` = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"
const DEFAULT_AZTEC_NODE_URL = env.AZTEC_NODE_URL ?? "https://devnet.aztec-labs.com"

const REQUIRED_ENV_VARS = ["EVM_PK", "AZTEC_SECRET_KEY", "AZTEC_KEY_SALT"] as const
const missingEnvVar = REQUIRED_ENV_VARS.find((key) => !env[key])
const browserE2EEnabled = env.BROWSER_E2E === "true"
const canRunE2E = browserE2EEnabled && !missingEnvVar

if (!canRunE2E) {
  const reason = !browserE2EEnabled ? "BROWSER_E2E flag is not set" : `Missing ${missingEnvVar}`
  console.warn(`[browser-e2e] skipping E2E tests: ${reason}`)
}

const describeE2E = canRunE2E ? describe : describe.skip

async function setupBrowserAztecAccount() {
  const aztecNode = createAztecNodeClient(DEFAULT_AZTEC_NODE_URL)

  const secretKey = Fr.fromHexString(env.AZTEC_SECRET_KEY as Hex)
  const salt = Fr.fromHexString(env.AZTEC_KEY_SALT as Hex)
  const testWallet = await TestWallet.create(aztecNode, {
    l1Contracts: await aztecNode.getL1ContractAddresses(),
    proverEnabled: false,
  })

  const accountManager = await testWallet.createSchnorrAccount(secretKey, salt)

  try {
    const deployMethod = await accountManager.getDeployMethod()
    const completeAddress = await accountManager.getCompleteAddress()
    await deployMethod.send({ from: completeAddress.address }).wait()
  } catch (e) {
    // Account already deployed or error deploying
  }

  return { wallet: testWallet, aztecAddress: accountManager.address }
}

/**
 * Bridge E2E Tests (Browser)
 *
 * ⚠️ PREREQUISITES:
 * - Set BROWSER_E2E=true to enable these tests
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
          tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
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
          tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
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

      const evmAddress = (env.EVM_ADDRESS as `0x${string}`) ?? "0x0000000000000000000000000000000000000000"

      const result = await bridge.openOrder(
        {
          chainIdIn: aztecSepolia.id,
          chainIdOut: baseSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
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

      const evmAddress = (env.EVM_ADDRESS as `0x${string}`) ?? "0x0000000000000000000000000000000000000000"

      const result = await bridge.openOrder(
        {
          chainIdIn: aztecSepolia.id,
          chainIdOut: baseSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
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
