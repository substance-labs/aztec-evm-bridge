/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-empty-object-type */

import { describe, expect, it, beforeAll } from "vitest"
import { baseSepolia } from "viem/chains"
import { Fr } from "@aztec/aztec.js/fields"
import { privateKeyToAddress } from "viem/accounts"
import { Hex, isHex, padHex } from "viem"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TestWallet } from "@aztec/test-wallet/client/lazy"

import { Bridge, aztecSepolia } from "../../src"
import type { BridgeConfigs } from "../../src"
import { getBrowserTestEnv } from "./env"

// Empty interface for future extension
interface BrowserWindow extends Window {}

const env = getBrowserTestEnv()

const WETH_ON_AZTEC_SEPOLIA_ADDRESS = "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
const WETH_ON_BASE_SEPOLIA_ADDRESS = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"
const DEFAULT_AZTEC_NODE_URL = env.AZTEC_NODE_URL ?? "https://devnet.aztec-labs.com"

const REQUIRED_ENV_VARS = ["EVM_PK", "AZTEC_SECRET_KEY", "AZTEC_KEY_SALT"] as const
const missingEnvVar = REQUIRED_ENV_VARS.find((key) => !env[key])
const browserE2EEnabled = true //env.BROWSER_E2E === "true"
const canRunE2E = browserE2EEnabled && !missingEnvVar

if (!canRunE2E) {
  const reason = !browserE2EEnabled ? "BROWSER_E2E flag is not set" : `Missing ${missingEnvVar}`
  console.warn(`[browser-e2e] skipping Base→Aztec test: ${reason}`)
}

const describeE2E = canRunE2E ? describe : describe.skip

interface BaseToAztecTestOptions {
  // Future: add options for PXE configuration if needed
}

async function setupBrowserAztecAccount() {
  // Create Aztec node client
  const aztecNode = createAztecNodeClient(DEFAULT_AZTEC_NODE_URL)

  // Create TestWallet - it handles PXE creation internally
  const secretKey = Fr.fromHexString(env.AZTEC_SECRET_KEY as Hex)
  const salt = Fr.fromHexString(env.AZTEC_KEY_SALT as Hex)
  const testWallet = await TestWallet.create(aztecNode, {
    l1Contracts: await aztecNode.getL1ContractAddresses(),
    proverEnabled: false,
  })

  // Create account using TestWallet
  const accountManager = await testWallet.createSchnorrAccount(secretKey, salt)

  // Deploy account if needed
  try {
    const deployMethod = await accountManager.getDeployMethod()
    const completeAddress = await accountManager.getCompleteAddress()
    await deployMethod.send({ from: completeAddress.address }).wait()
  } catch (e) {
    console.log("Account already deployed or error deploying:", e)
  }

  const aztecAddress = accountManager.address

  return { wallet: testWallet, aztecAddress }
}

function createBaseToAztecTest(titleSuffix: string, _options?: BaseToAztecTestOptions) {
  const fullTitle = ["should open a private order from Base to Aztec", titleSuffix].filter(Boolean).join(" ")

  it(fullTitle, async () => {
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
}

describeE2E("Bridge (browser) E2E", { timeout: 600000 }, () => {
  createBaseToAztecTest("", {})
})
