import { describe, expect, beforeEach, afterEach, it } from "vitest"
import { Fr } from "@aztec/aztec.js/fields"
import { Hex, isHex, padHex } from "viem"
import type { AzguardClient } from "@azguardwallet/client"
import { privateKeyToAddress } from "viem/accounts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { TestWallet } from "@aztec/test-wallet/server"
import { rmSync } from "fs"

import { Bridge, chainsConfig, ResolvedOrder, OrderDataEncoder, getAztecAddressFromAzguardAccount } from "../src"

// Token addresses must match filler config for e2e tests to work
if (!process.env.AZTEC_TOKEN_ADDRESS) {
  throw new Error("AZTEC_TOKEN_ADDRESS environment variable is required")
}
if (!process.env.EVM_TOKEN_ADDRESS) {
  throw new Error("EVM_TOKEN_ADDRESS environment variable is required")
}

const TOKEN_ON_AZTEC_ADDRESS = process.env.AZTEC_TOKEN_ADDRESS as Hex
const TOKEN_ON_BASE_ADDRESS = process.env.EVM_TOKEN_ADDRESS as Hex

// Check if external filler service is running
const EXTERNAL_FILLER = process.env.EXTERNAL_FILLER === "true" || process.env.USE_EXTERNAL_FILLER === "true"

/**
 * Helper function to fill an order when no external filler is running.
 * This allows tests to be self-contained without requiring a separate filler service.
 */
async function selfFillOrder(bridge: Bridge, orderId: Hex, resolvedOrder: ResolvedOrder): Promise<Hex> {
  const orderData = OrderDataEncoder.decode(resolvedOrder.fillInstructions[0].originData)
  return await bridge.fillOrder({ orderId, orderData })
}

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
  if (!process.env.AZTEC_RPC_URL) {
    throw new Error("AZTEC_RPC_URL must be set")
  }

  cleanupPxeStore()

  const aztecNodeUrl = process.env.AZTEC_RPC_URL
  const aztecNode = createAztecNodeClient(aztecNodeUrl)

  const testWallet = await TestWallet.create(aztecNode, {
    l1Contracts: await aztecNode.getL1ContractAddresses(),
    proverEnabled: true, // Required for devnet
  })

  // Register the Sponsored FPC contract before creating accounts
  const { getSponsoredFPCInstance, SponsoredFPCContractArtifact } = await import("../src/utils/fpc")
  const sponsoredFPC = await getSponsoredFPCInstance()
  await testWallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact)

  const secretKey = Fr.fromHexString(process.env.AZTEC_SECRET_KEY)
  const salt = Fr.fromHexString(process.env.AZTEC_KEY_SALT)

  const accountManager = await testWallet.createSchnorrAccount(secretKey, salt)
  const aztecAddress = accountManager.address

  await testWallet.registerSender(aztecAddress)

  // Note: Account deployment is skipped as the account should already be deployed on devnet
  // If not deployed, the first transaction will fail

  return { wallet: testWallet, aztecAddress }
}

/**
 * Bridge E2E Tests
 *
 * ⚠️ IMPORTANT:
 * - Ensure accounts own WETH on both Base Sepolia and Aztec Sepolia
 * - Set required environment variables: AZTEC_SECRET_KEY, AZTEC_KEY_SALT, EVM_PK
 *
 * 📋 FILLER MODES:
 * - EXTERNAL_FILLER=false (default): Tests self-fill orders, no external filler service needed
 * - EXTERNAL_FILLER=true: Tests rely on external filler service, explicit fill tests are skipped
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
          evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
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
      const azguardClient = {
        accounts: ["aztec:1:0x1234567890123456789012345678901234567890123456789012345678901234"],
        execute: async () => ({ success: true }),
      } as unknown as AzguardClient

      const bridge = await Bridge.create({
        azguardClient,
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
      let capturedOrderId: Hex | undefined
      let capturedResolvedOrder: ResolvedOrder | undefined

      // If no external filler, we need to capture order details and self-fill
      const openOrderPromise = bridge.openOrder(
        {
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.baseSepolia.chain.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: TOKEN_ON_AZTEC_ADDRESS,
          tokenOut: TOKEN_ON_BASE_ADDRESS,
          mode: "public",
          data: padHex("0x"),
          recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
        },
        {
          onOrderOpened: ({ orderId, resolvedOrder }) => {
            console.log("onOrderOpened called")
            onOrderOpenedCalled = true
            capturedOrderId = orderId
            capturedResolvedOrder = resolvedOrder
            // Self-fill if no external filler
            if (!EXTERNAL_FILLER && capturedOrderId && capturedResolvedOrder) {
              selfFillOrder(bridge, capturedOrderId, capturedResolvedOrder).catch(console.error)
            }
          },
          onOrderFilled: () => {
            console.log("onOrderFilled called")
            onOrderFilledCalled = true
          },
        },
      )

      const result = await openOrderPromise

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

      let capturedOrderId: Hex | undefined
      let capturedResolvedOrder: ResolvedOrder | undefined

      const result = await bridge.openOrder(
        {
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.baseSepolia.chain.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: TOKEN_ON_AZTEC_ADDRESS,
          tokenOut: TOKEN_ON_BASE_ADDRESS,
          mode: "private",
          data: padHex("0x"),
          recipient: padHex(privateKeyToAddress(process.env.EVM_PK as Hex)),
        },
        {
          onOrderOpened: ({ transactionHash, orderId, resolvedOrder }) => {
            expect(isHex(transactionHash)).toBe(true)
            capturedOrderId = orderId
            capturedResolvedOrder = resolvedOrder
            // Self-fill if no external filler
            if (!EXTERNAL_FILLER && capturedOrderId && capturedResolvedOrder) {
              selfFillOrder(bridge, capturedOrderId, capturedResolvedOrder).catch(console.error)
            }
          },
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
              chainIdIn: chainsConfig.aztecDevnet.chain.id,
              chainIdOut: chainsConfig.baseSepolia.chain.id,
              amountIn: 1n,
              amountOut: 1000000000n,
              tokenIn: TOKEN_ON_AZTEC_ADDRESS,
              tokenOut: TOKEN_ON_BASE_ADDRESS,
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
        chainIdIn: chainsConfig.aztecDevnet.chain.id,
        chainIdOut: chainsConfig.baseSepolia.chain.id,
      })
      expect(isHex(txHash)).toBe(true)
    })

    // Skip explicit fill test when external filler is running (redundant with self-filling tests)
    it.skipIf(EXTERNAL_FILLER)("should open a private order and fill it", async () => {
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      const openOrder = (): Promise<{ orderId: Hex; resolvedOrder: ResolvedOrder }> =>
        new Promise((resolve) => {
          bridge.openOrder(
            {
              chainIdIn: chainsConfig.aztecDevnet.chain.id,
              chainIdOut: chainsConfig.baseSepolia.chain.id,
              amountIn: 1n,
              amountOut: 1n,
              tokenIn: TOKEN_ON_AZTEC_ADDRESS,
              tokenOut: TOKEN_ON_BASE_ADDRESS,
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
      const txHash = await selfFillOrder(bridge, orderId, resolvedOrder)
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
      let capturedOrderId: Hex | undefined
      let capturedResolvedOrder: ResolvedOrder | undefined

      const result = await bridge.openOrder(
        {
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: chainsConfig.aztecDevnet.chain.id,
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
          onOrderOpened: ({ orderId, resolvedOrder }) => {
            onOrderOpenedCalled = true
            capturedOrderId = orderId
            capturedResolvedOrder = resolvedOrder
            // Self-fill if no external filler
            if (!EXTERNAL_FILLER && capturedOrderId && capturedResolvedOrder) {
              selfFillOrder(bridge, capturedOrderId, capturedResolvedOrder).catch(console.error)
            }
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
      let capturedOrderId: Hex | undefined
      let capturedResolvedOrder: ResolvedOrder | undefined

      const result = await bridge.openOrder(
        {
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: chainsConfig.aztecDevnet.chain.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: TOKEN_ON_BASE_ADDRESS,
          tokenOut: TOKEN_ON_AZTEC_ADDRESS,
          mode: "public",
          data: padHex("0x"),
          recipient: aztecAddress.toString(),
        },
        {
          onOrderOpened: ({ orderId, resolvedOrder }) => {
            onOrderOpenedCalled = true
            capturedOrderId = orderId
            capturedResolvedOrder = resolvedOrder
            // Self-fill if no external filler
            if (!EXTERNAL_FILLER && capturedOrderId && capturedResolvedOrder) {
              selfFillOrder(bridge, capturedOrderId, capturedResolvedOrder).catch(console.error)
            }
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
              chainIdIn: chainsConfig.baseSepolia.chain.id,
              chainIdOut: chainsConfig.aztecDevnet.chain.id,
              amountIn: 1n,
              amountOut: 1000000000n,
              tokenIn: TOKEN_ON_BASE_ADDRESS,
              tokenOut: TOKEN_ON_AZTEC_ADDRESS,
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
        chainIdIn: chainsConfig.baseSepolia.chain.id,
        chainIdOut: chainsConfig.aztecDevnet.chain.id,
      })
      expect(isHex(txHash)).toBe(true)
    })

    // Skip explicit fill test when external filler is running (redundant with self-filling tests)
    it.skipIf(EXTERNAL_FILLER)("should open a private order and fill it", async () => {
      const { wallet } = await setup()
      const bridge = await Bridge.create({
        evmPrivateKey: process.env.EVM_PK as Hex,
        aztecWallet: wallet,
      })

      const openOrder = (): Promise<{ orderId: Hex; resolvedOrder: ResolvedOrder }> =>
        new Promise((resolve) => {
          bridge.openOrder(
            {
              chainIdIn: chainsConfig.baseSepolia.chain.id,
              chainIdOut: chainsConfig.aztecDevnet.chain.id,
              amountIn: 1n,
              amountOut: 1n,
              tokenIn: TOKEN_ON_BASE_ADDRESS,
              tokenOut: TOKEN_ON_AZTEC_ADDRESS,
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
      const txHash = await selfFillOrder(bridge, orderId, resolvedOrder)
      expect(isHex(txHash)).toBe(true)
    })
  })
})
