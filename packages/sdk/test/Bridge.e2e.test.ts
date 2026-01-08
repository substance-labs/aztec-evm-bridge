import { describe, expect, beforeEach, afterEach, it, vi } from "vitest"
import { Fr } from "@aztec/aztec.js/fields"
import { baseSepolia } from "viem/chains"
import { Hex, isHex, padHex } from "viem"
import { AzguardClient } from "@azguardwallet/client"
import { privateKeyToAddress } from "viem/accounts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { TestWallet } from "@aztec/test-wallet/server"
import { rmSync } from "fs"

import { Bridge, aztecSepolia, ResolvedOrder, OrderDataEncoder, getAztecAddressFromAzguardAccount } from "../src"

const WETH_ON_AZTEC_SEPOLIA_ADDRESS = "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
const WETH_ON_BASE_SEPOLIA_ADDRESS = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"

const cleanupPxeStore = () => {
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
}

const setup = async () => {
  if (!process.env.AZTEC_SECRET_KEY || !process.env.AZTEC_KEY_SALT) {
    throw new Error("AZTEC_SECRET_KEY and AZTEC_KEY_SALT must be set")
  }

  cleanupPxeStore()

  const aztecNodeUrl = "https://devnet.aztec-labs.com"
  const aztecNode = createAztecNodeClient(aztecNodeUrl)

  const testWallet = await TestWallet.create(aztecNode, {
    l1Contracts: await aztecNode.getL1ContractAddresses(),
    proverEnabled: false,
  })

  const secretKey = Fr.fromHexString(process.env.AZTEC_SECRET_KEY)
  const salt = Fr.fromHexString(process.env.AZTEC_KEY_SALT)

  const accountManager = await testWallet.createSchnorrAccount(secretKey, salt)
  const aztecAddress = accountManager.address

  await testWallet.registerSender(aztecAddress)

  try {
    const deployMethod = await accountManager.getDeployMethod()
    const completeAddress = await accountManager.getCompleteAddress()
    await deployMethod.send({ from: completeAddress.address }).wait()
  } catch (e: unknown) {
    const error = e as Error
    const isAlreadyDeployed = error?.message?.includes("Existing nullifier")
    if (!isAlreadyDeployed) {
      console.error("Unexpected error deploying account:", error?.message || String(e))
    }
  }

  return { wallet: testWallet, aztecAddress }
}

/**
 * Bridge E2E Tests
 *
 * ⚠️ IMPORTANT:
 * - Ensure accounts own WETH on both Base Sepolia and Aztec Sepolia
 * - A filler service must be running for order fill tests
 * - Set required environment variables: AZTEC_SECRET_KEY, AZTEC_KEY_SALT, EVM_PK
 */
describe("Bridge E2E", { timeout: 600000 }, () => {
  beforeEach(async () => {
    cleanupPxeStore()
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  afterEach(() => {
    cleanupPxeStore()
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

    it("should accept azguardClient in constructor", async () => {
      const mockAzguardClient = {
        accounts: ["aztec:1:0x1234567890123456789012345678901234567890123456789012345678901234"],
        execute: vi.fn(),
      } as unknown as AzguardClient

      const bridge = await Bridge.create({
        azguardClient: mockAzguardClient,
        evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      })

      expect(bridge).toBeDefined()
    })
  })

  describe("Account Handling", () => {
    it("should handle azguardClient account in CAIP format", () => {
      const caipAccount = "aztec:1:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const
      const address = getAztecAddressFromAzguardAccount(caipAccount)
      expect(address).toBe("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef")
    })

    it("should extract address from CAIP format correctly", () => {
      const caipAccount = "aztec:31337:0xabcdef" as const
      const address = getAztecAddressFromAzguardAccount(caipAccount)
      expect(address).toBe("0xabcdef")
    })
  })

  describe("Aztec → Base (TestWallet)", () => {
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
          mode: "private",
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

    it("should open a private order and then refund it", async () => {
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
              fillDeadline: 5,
            },
            {
              onOrderOpened: ({ orderId }) => resolve(orderId),
            },
          )
        })

      const orderId = await openOrder()
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const txHash = await bridge.refundOrder({
        orderId,
        chainIdIn: aztecSepolia.id,
        chainIdOut: baseSepolia.id,
      })
      expect(isHex(txHash)).toBe(true)
    })

    it.skip("should open a private order and fill it", async () => {
      // NOTE: Skipped - requires filler service with sufficient output tokens
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

  describe("Base → Aztec (TestWallet)", () => {
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

    it("should open a private order and then refund it", async () => {
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
              amountOut: 1000000000n,
              tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
              tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
              mode: "private",
              data: padHex("0x"),
              recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
              fillDeadline: 5,
            },
            {
              onOrderOpened: ({ orderId }) => resolve(orderId),
            },
          )
        })

      const orderId = await openOrder()
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const txHash = await bridge.refundOrder({
        orderId,
        chainIdIn: baseSepolia.id,
        chainIdOut: aztecSepolia.id,
      })
      expect(isHex(txHash)).toBe(true)
    })

    it.skip("should open a private order and fill it", async () => {
      // NOTE: Skipped - requires filler service
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
  })

  /**
   * Azguard Wallet Integration Tests
   *
   * ⚠️ PREREQUISITES:
   * 1. Initialize AzguardClient and pass to tests
   * 2. Ensure Azguard wallet is running and accessible
   * 3. Account should have WETH on both chains
   * 4. A filler service must be running
   *
   * Remove .skip to run when Azguard is available.
   */
  describe.skip("Aztec → Base (Azguard)", () => {
    let azguardClient: AzguardClient

    beforeEach(async () => {
      cleanupPxeStore()
      // TODO: Initialize AzguardClient instance
      azguardClient = null as unknown as AzguardClient
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    it("should open a public order from Aztec to Base", async () => {
      const bridge = await Bridge.create({
        azguardClient,
        evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      })

      const evmAddress = process.env.EVM_ADDRESS as `0x${string}`
      let orderOpenedTxHash: string | undefined
      let orderFilledTxHash: string | undefined

      const result = await bridge.openOrder(
        {
          chainIdIn: aztecSepolia.id,
          chainIdOut: baseSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: padHex(WETH_ON_BASE_SEPOLIA_ADDRESS),
          recipient: padHex(evmAddress),
          mode: "public",
          data: padHex("0x"),
        },
        {
          onOrderOpened: ({ transactionHash }) => {
            orderOpenedTxHash = transactionHash
          },
          onOrderFilled: ({ transactionHash }) => {
            orderFilledTxHash = transactionHash
          },
        },
      )

      expect(result.orderOpenedTxHash).toBeDefined()
      expect(result.resolvedOrder.orderId).toBeDefined()
      expect(orderOpenedTxHash).toBeDefined()
      expect(orderFilledTxHash).toBeDefined()
    })

    it("should open a private order from Aztec to Base", async () => {
      const bridge = await Bridge.create({
        azguardClient,
        evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      })

      const evmAddress = process.env.EVM_ADDRESS as `0x${string}`
      let secret: string | undefined

      const result = await bridge.openOrder(
        {
          chainIdIn: aztecSepolia.id,
          chainIdOut: baseSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: padHex(WETH_ON_BASE_SEPOLIA_ADDRESS),
          recipient: padHex(evmAddress),
          mode: "private",
          data: padHex("0x"),
        },
        {
          onSecret: ({ secret: s }) => {
            secret = s
          },
        },
      )

      expect(result.orderOpenedTxHash).toBeDefined()
      expect(secret).toBeDefined()
      expect(secret?.startsWith("0x")).toBe(true)
    })
  })

  describe.skip("Base → Aztec (Azguard)", () => {
    let azguardClient: AzguardClient

    beforeEach(async () => {
      cleanupPxeStore()
      // TODO: Initialize AzguardClient instance
      azguardClient = null as unknown as AzguardClient
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    it("should open a public order from Base to Aztec", async () => {
      const bridge = await Bridge.create({
        azguardClient,
        evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      })

      const selectedAccount = azguardClient.accounts[0]
      const aztecAddress = getAztecAddressFromAzguardAccount(selectedAccount)

      const result = await bridge.openOrder(
        {
          chainIdIn: baseSepolia.id,
          chainIdOut: aztecSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: padHex(WETH_ON_BASE_SEPOLIA_ADDRESS),
          tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          recipient: aztecAddress,
          mode: "public",
          data: padHex("0x"),
        },
        {
          onOrderFilled: () => {},
          onOrderClaimed: () => {},
        },
      )

      expect(result.orderOpenedTxHash).toBeDefined()
    })

    it("should open a private order from Base to Aztec", async () => {
      const bridge = await Bridge.create({
        azguardClient,
        evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      })

      const selectedAccount = azguardClient.accounts[0]
      const aztecAddress = getAztecAddressFromAzguardAccount(selectedAccount)
      let secret: string | undefined
      let orderClaimedTxHash: string | undefined

      const result = await bridge.openOrder(
        {
          chainIdIn: baseSepolia.id,
          chainIdOut: aztecSepolia.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: padHex(WETH_ON_BASE_SEPOLIA_ADDRESS),
          tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          recipient: aztecAddress,
          mode: "private",
          data: padHex("0x"),
        },
        {
          onSecret: ({ secret: s }) => {
            secret = s
          },
          onOrderClaimed: ({ transactionHash }) => {
            orderClaimedTxHash = transactionHash
          },
        },
      )

      expect(result.orderOpenedTxHash).toBeDefined()
      expect(secret).toBeDefined()
      expect(orderClaimedTxHash).toBeDefined()
    })
  })
})
