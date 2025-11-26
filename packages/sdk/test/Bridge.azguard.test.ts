import { describe, expect, beforeEach, afterEach, it } from "vitest"
import { baseSepolia } from "viem/chains"
import { padHex } from "viem"
import { AzguardClient } from "@azguardwallet/client"
import { rmSync } from "fs"

import { Bridge, aztecSepolia, getAztecAddressFromAzguardAccount } from "../src"

const WETH_ON_AZTEC_SEPOLIA_ADDRESS = "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
const WETH_ON_BASE_SEPOLIA_ADDRESS = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"

/**
 * Azguard Wallet Integration Tests
 *
 * These tests verify that the Bridge works correctly with AzguardClient.
 *
 * ⚠️ PREREQUISITES:
 * 1. Set AZGUARD_CLIENT_INSTANCE environment variable or pass azguardClient instance
 * 2. Ensure Azguard wallet is running and accessible
 * 3. Account should have WETH on both chains
 * 4. A filler service must be running
 *
 * Note: These tests are skipped by default since they require external Azguard setup.
 * Remove .skip to run them when Azguard is available.
 *
 * HOW TO RUN:
 * 1. Initialize AzguardClient in your environment (see Azguard documentation)
 * 2. Pass it to these tests or set up a test fixture
 * 3. Remove .skip from the describe block
 * 4. Run: yarn test Bridge.azguard.test.ts
 */
describe.skip("Bridge with Azguard Wallet", { timeout: 600000 }, () => {
  let azguardClient: AzguardClient

  beforeEach(async () => {
    // Clean up PXE store before each test
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

    // TODO: Initialize AzguardClient instance
    // AzguardClient has a private constructor, so you need to:
    // 1. Use the proper Azguard SDK initialization method
    // 2. Or pass a pre-initialized instance from your test environment
    //
    // Example (pseudo-code):
    // azguardClient = await getAzguardClientFromEnvironment()
    //
    // For now, this will throw a TypeScript error until proper setup is done
    azguardClient = null as unknown as AzguardClient

    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  afterEach(async () => {
    // Clean up after tests
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
    it("should create bridge with azguardClient", async () => {
      const bridge = await Bridge.create({
        azguardClient,
        evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      })

      expect(bridge).toBeDefined()
    })

    it("should validate azguardClient is provided", async () => {
      await expect(
        Bridge.create({
          evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
        }),
      ).rejects.toThrow("You must specify aztecWallet or azguardClient")
    })
  })

  describe("Aztec → EVM Orders (with Azguard)", () => {
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
          amountIn: 1n, // 1 wei
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
            console.log("Order opened (Azguard):", transactionHash)
          },
          onOrderFilled: ({ transactionHash }) => {
            orderFilledTxHash = transactionHash
            console.log("Order filled:", transactionHash)
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
            console.log("Secret generated (Azguard):", s)
          },
        },
      )

      expect(result.orderOpenedTxHash).toBeDefined()
      expect(secret).toBeDefined()
      expect(secret?.startsWith("0x")).toBe(true)
    })
  })

  describe("EVM → Aztec Orders (with Azguard)", () => {
    it("should open a public order from Base to Aztec", async () => {
      const bridge = await Bridge.create({
        azguardClient,
        evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      })

      // Get Aztec address from azguardClient account in CAIP format
      const selectedAccount = azguardClient.accounts[0]
      const aztecAddress = getAztecAddressFromAzguardAccount(selectedAccount)

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
          mode: "public",
          data: padHex("0x"),
        },
        {
          onOrderFilled: () => {
            console.log("Order filled (Azguard)")
          },
          onOrderClaimed: ({ transactionHash }) => {
            orderClaimedTxHash = transactionHash
            console.log("Order claimed (Azguard):", transactionHash)
          },
        },
      )

      expect(result.orderOpenedTxHash).toBeDefined()
      // Public orders on EVM->Aztec don't require claiming
      // The fill happens directly
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
            console.log("Secret (Azguard):", s)
          },
          onOrderClaimed: ({ transactionHash }) => {
            orderClaimedTxHash = transactionHash
            console.log("Order claimed (Azguard):", transactionHash)
          },
        },
      )

      expect(result.orderOpenedTxHash).toBeDefined()
      expect(secret).toBeDefined()
      // SDK should auto-claim with Azguard wallet
      expect(orderClaimedTxHash).toBeDefined()
    })
  })

  describe("Refund Operations (with Azguard)", () => {
    it.skip("should refund an Aztec to EVM order", async () => {
      // TODO: Implement refund test with Azguard
      // This requires opening an order and waiting for expiry
    })

    it.skip("should refund an EVM to Aztec order", async () => {
      // TODO: Implement refund test with Azguard
    })
  })

  describe("Fill Operations (with Azguard)", () => {
    it.skip("should fill an order as a liquidity provider", async () => {
      // TODO: Implement fill operation test with Azguard
      // This requires monitoring for orders and filling them
    })
  })
})
