import { describe, expect, beforeEach, afterEach, it } from "vitest"
import { Fr } from "@aztec/aztec.js/fields"
import { baseSepolia } from "viem/chains"
import { Hex, isHex, padHex } from "viem"
import { AzguardClient } from "@azguardwallet/client"
import { privateKeyToAddress } from "viem/accounts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { TestWallet } from "@aztec/test-wallet/server"
import { rmSync } from "fs"

import { Bridge, aztecSepolia, ResolvedOrder, OrderDataEncoder } from "../src"

const WETH_ON_AZTEC_SEPOLIA_ADDRESS = "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
const WETH_ON_BASE_SEPOLIA_ADDRESS = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"

const setup = async () => {
  if (!process.env.AZTEC_SECRET_KEY || !process.env.AZTEC_KEY_SALT) {
    throw new Error("AZTEC_SECRET_KEY and AZTEC_KEY_SALT must be set")
  }

  // Clean up PXE store before creating TestWallet to avoid corruption
  try {
    rmSync(".aztec-pxe", { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
  try {
    rmSync("store/aztec-pxe", { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }

  const aztecNodeUrl = "https://devnet.aztec-labs.com"
  const aztecNode = createAztecNodeClient(aztecNodeUrl)

  // Create TestWallet - it will create its own PXE with proper contract syncing
  const testWallet = await TestWallet.create(aztecNode, {
    l1Contracts: await aztecNode.getL1ContractAddresses(),
    proverEnabled: false,
  })

  const secretKey = Fr.fromHexString(process.env.AZTEC_SECRET_KEY)
  const salt = Fr.fromHexString(process.env.AZTEC_KEY_SALT)

  // Create account using TestWallet
  const accountManager = await testWallet.createSchnorrAccount(secretKey, salt)
  const aztecAddress = accountManager.address

  // Register the account address as a sender so TestWallet can act on its behalf
  await testWallet.registerSender(aztecAddress)

  // Try to deploy account if not already deployed
  try {
    const deployMethod = await accountManager.getDeployMethod()
    const completeAddress = await accountManager.getCompleteAddress()
    await deployMethod.send({ from: completeAddress.address }).wait()
  } catch (e: unknown) {
    const error = e as Error
    // Silently ignore if account is already deployed (Existing nullifier error)
    // This is expected behavior when running tests multiple times
    const isAlreadyDeployed = error?.message?.includes("Existing nullifier")
    if (!isAlreadyDeployed) {
      // Only log unexpected errors
      console.error("Unexpected error deploying account:", error?.message || String(e))
    }
  }

  return {
    wallet: testWallet,
    aztecAddress,
  }
}

/**
 * ⚠️ IMPORTANT:
 * Be sure to use accounts that own WETH on both Base Sepolia and Aztec Sepolia
 * and that a filler is up and running.
 *
 * If your account doesn't have WETH on Aztec Sepolia, you can:
 * - Use our bridge: https://devnet.aztec-labs.com
 * - Or use the integrated faucet within the bridge interface.
 */
describe("Bridge", { timeout: 600000 }, () => {
  beforeEach(async () => {
    // Clean up PXE store before each test to avoid state conflicts
    try {
      rmSync(".aztec-pxe", { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    try {
      rmSync("store/aztec-pxe", { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    // Small delay to ensure filesystem cleanup completes
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  afterEach(async () => {
    // Clean up PXE store after each test
    try {
      rmSync(".aztec-pxe", { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    try {
      rmSync("store/aztec-pxe", { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("Initialization", () => {
    it("cannot initialize bridge without aztecWallet or azguardClient", async () => {
      await expect(
        Bridge.create({
          evmPrivateKey: process.env.EVM_PK as Hex,
        }),
      ).rejects.toThrow("You must specify aztecWallet or azguardClient")
    })

    it("cannot specify evmPrivateKey and evmProvider", async () => {
      await expect(
        Bridge.create({
          azguardClient: {} as AzguardClient,
          evmPrivateKey: process.env.EVM_PK as Hex,
          evmProvider: {},
        }),
      ).rejects.toThrow("Cannot specify both evmPrivateKey and evmProvider")
    })

    it("cannot initialize bridge using aztecWallet and azguardClient", async () => {
      await expect(
        Bridge.create({
          evmPrivateKey: process.env.EVM_PK as Hex,
          aztecWallet: {} as Wallet,
          azguardClient: {} as AzguardClient,
        }),
      ).rejects.toThrow("Cannot specify both azguardClient and aztecWallet")
    })
  })

  describe("Aztec -> Base", () => {
    it("should create a public order from Aztec to Base", async () => {
      const { wallet } = await setup()

      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })
      let onOrderOpenedCalled = false
      let onOrderFilledCalled = false
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
          recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
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
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })
      const result = await bridge.openOrder(
        {
          chainIdIn: aztecSepolia.id,
          chainIdOut: baseSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
          mode: "private", // or public,
          data: padHex("0x"),
          recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
        },
        {
          onOrderOpened: ({ transactionHash }) => expect(isHex(transactionHash)).toBe(true),
          onOrderFilled: ({ transactionHash }) => expect(isHex(transactionHash)).toBe(true),
        },
      )
      expect(isHex(result.orderOpenedTxHash)).toBe(true)
      expect(isHex(result.orderFilledTxHash)).toBe(true)
    })

    it("should open a private order from Aztec to Base and then ask for a refund", async () => {
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })
      const openOrder = (): Promise<Hex> =>
        new Promise((resolve) => {
          bridge.openOrder(
            {
              chainIdIn: aztecSepolia.id,
              chainIdOut: baseSepolia.id,
              amountIn: 1n,
              amountOut: 1000000000n,
              tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
              tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
              mode: "private",
              data: padHex("0x"),
              recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
              fillDeadline: 5, // Short deadline
            },
            {
              onOrderOpened: ({ orderId }) => resolve(orderId),
            },
          )
        })
      const orderId = await openOrder()

      // Wait a moment to let the order propagate
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const txHash = await bridge.refundOrder({
        orderId,
        chainIdIn: aztecSepolia.id,
        chainIdOut: baseSepolia.id,
      })
      expect(isHex(txHash)).toBe(true)
    })

    it.skip("should open a private order from Aztec to Base and fill it", async () => {
      // NOTE: This test is skipped because filling Aztec→EVM orders requires:
      // 1. The filler service to be running
      // 2. The filler to have sufficient output tokens (WETH on Base)
      // 3. Proper token approvals
      // The fillOrder method is designed for the filler service, not end users
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })
      const openOrder = (): Promise<{ orderId: Hex; resolvedOrder: ResolvedOrder }> =>
        new Promise((resolve) => {
          bridge.openOrder(
            {
              chainIdIn: aztecSepolia.id,
              chainIdOut: baseSepolia.id,
              amountIn: 1n,
              amountOut: 1n,
              tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
              tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
              mode: "private",
              data: padHex("0x"),
              recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
            },
            {
              onOrderOpened: ({ orderId, resolvedOrder }) => resolve({ orderId, resolvedOrder }),
            },
          )
        })
      const { orderId, resolvedOrder } = await openOrder()
      const txHash = await bridge.fillOrder({
        orderId,
        orderData: OrderDataEncoder.decode(resolvedOrder.fillInstructions[0].originData),
      })
      expect(isHex(txHash)).toBe(true)
    })
  })

  describe("Base -> Aztec", () => {
    it("should open a private order from Base to Aztec", async () => {
      const { wallet, aztecAddress } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      let onOrderOpenedCalled = false
      let onOrderFilledCalled = false
      let onSecretCalled = false
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
      const { wallet, aztecAddress } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
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

    it("should open a private order from Base to Aztec and then ask for a refund", async () => {
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      const openOrder = (): Promise<Hex> =>
        new Promise((resolve) => {
          bridge.openOrder(
            {
              chainIdIn: baseSepolia.id,
              chainIdOut: aztecSepolia.id,
              amountIn: 1n,
              amountOut: 1000000000n, // Very high amountOut to discourage fillers
              tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
              tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
              mode: "private",
              data: padHex("0x"),
              recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
              fillDeadline: 5, // Short deadline
            },
            {
              onOrderOpened: ({ orderId }) => resolve(orderId),
            },
          )
        })
      const orderId = await openOrder()

      // Wait a moment to let the order settle
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const txHash = await bridge.refundOrder({
        orderId,
        chainIdIn: baseSepolia.id,
        chainIdOut: aztecSepolia.id,
      })
      expect(isHex(txHash)).toBe(true)
    })

    it.skip("should open a private order from Base to Aztec and then fill it", async () => {
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      const openOrder = (): Promise<{ orderId: Hex; resolvedOrder: ResolvedOrder }> =>
        new Promise((resolve) => {
          bridge.openOrder(
            {
              chainIdIn: baseSepolia.id,
              chainIdOut: aztecSepolia.id,
              amountIn: 1n,
              amountOut: 1n,
              tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
              tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
              mode: "private",
              data: padHex("0x"),
              recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
            },
            {
              onOrderOpened: ({ orderId, resolvedOrder }) => resolve({ orderId, resolvedOrder }),
            },
          )
        })
      const { orderId, resolvedOrder } = await openOrder()
      const txHash = await bridge.fillOrder({
        orderId,
        orderData: OrderDataEncoder.decode(resolvedOrder.fillInstructions[0].originData),
      })
      expect(isHex(txHash)).toBe(true)
    })

    it.skip("should open a private order from Base to Aztec and then fill it", async () => {
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      const openOrder = (): Promise<{ orderId: Hex; resolvedOrder: ResolvedOrder }> =>
        new Promise((resolve) => {
          bridge.openOrder(
            {
              chainIdIn: baseSepolia.id,
              chainIdOut: aztecSepolia.id,
              amountIn: 1n,
              amountOut: 1n,
              tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
              tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
              mode: "public",
              data: padHex("0x"),
              recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
            },
            {
              onOrderOpened: ({ orderId, resolvedOrder }) => resolve({ orderId, resolvedOrder }),
            },
          )
        })
      const { orderId, resolvedOrder } = await openOrder()
      const txHash = await bridge.fillOrder({
        orderId,
        orderData: OrderDataEncoder.decode(resolvedOrder.fillInstructions[0].originData),
      })
      expect(isHex(txHash)).toBe(true)
    })
  })
})
