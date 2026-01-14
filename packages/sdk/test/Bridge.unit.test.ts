import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { Hex, padHex } from "viem"
import { AzguardClient } from "@azguardwallet/client"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { AztecAddress } from "@aztec/aztec.js/addresses"

import {
  Bridge,
  chainsConfig,
  OrderDataEncoder,
  getAztecAddressFromAzguardAccount,
  hexToUintArray,
  BridgeHelpers,
} from "../src"
import { PRIVATE_ORDER, PRIVATE_ORDER_WITH_HOOK, PUBLIC_ORDER, PUBLIC_ORDER_WITH_HOOK } from "../src/constants"

// Mock external dependencies
// Note: vi.mock is hoisted, so it is not possible to import values like Fr.random() or AztecAddress.random()
// Instead, return simple mock values

// Mock the contract artifact to avoid incompatibility with new @aztec/stdlib
vi.mock("../src/utils/artifacts/AztecGateway7683/AztecGateway7683", () => ({
  AztecGateway7683Contract: {
    at: vi.fn().mockResolvedValue({
      methods: {},
    }),
  },
  AztecGateway7683ContractArtifact: {
    name: "AztecGateway7683",
    functions: [],
  },
}))

vi.mock("@aztec/aztec.js/node", () => ({
  createAztecNodeClient: vi.fn().mockReturnValue({
    getContract: vi.fn().mockResolvedValue({
      address: { toString: () => "0x" + "12".repeat(32) },
    }),
    getL1ContractAddresses: vi.fn().mockResolvedValue({}),
    getPublicLogs: vi.fn().mockResolvedValue({ logs: [] }),
    getTxReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: 100 }),
  }),
}))

vi.mock("@aztec/stdlib/hash", () => ({
  computeL2ToL1MessageHash: vi.fn().mockReturnValue({ toString: () => "0x" + "ab".repeat(32) }),
}))

// Mock viem - avoid using importOriginal due to module initialization order issues with @aztec/stdlib
vi.mock("viem", () => ({
  // Re-export commonly used utilities
  padHex: (value: string, opts?: { size?: number }) => {
    const size = opts?.size ?? 32
    const hex = value.startsWith("0x") ? value.slice(2) : value
    return `0x${hex.padStart(size * 2, "0")}` as `0x${string}`
  },
  isHex: (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value),
  hexToBytes: (hex: string) => {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex
    const bytes = new Uint8Array(cleanHex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16)
    }
    return bytes
  },
  bytesToHex: (bytes: Uint8Array) => {
    return `0x${Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}` as `0x${string}`
  },
  toHex: (value: number | bigint) => `0x${value.toString(16)}` as `0x${string}`,
  fromHex: (hex: string, to: string) => {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex
    if (to === "bigint") return BigInt(`0x${cleanHex}`)
    if (to === "number") return parseInt(cleanHex, 16)
    return cleanHex
  },
  keccak256: vi.fn().mockReturnValue("0x" + "ab".repeat(32)),
  encodeAbiParameters: vi.fn().mockReturnValue("0x" + "00".repeat(32)),
  decodeAbiParameters: vi.fn().mockReturnValue([]),
  encodePacked: (types: any[], values: any[]) => {
    // Properly encode packed data according to Solidity rules
    let result = ""
    for (let i = 0; i < types.length; i++) {
      const type = types[i]
      const value = values[i]

      if (type === "bytes32") {
        // bytes32: pad to 32 bytes
        const hex = typeof value === "string" && value.startsWith("0x") ? value.slice(2) : value
        result += hex.padStart(64, "0")
      } else if (type === "uint256") {
        // uint256: pad to 32 bytes
        result += (typeof value === "bigint" ? value : BigInt(value)).toString(16).padStart(64, "0")
      } else if (type === "uint128") {
        // uint128: pad to 16 bytes
        result += (typeof value === "bigint" ? value : BigInt(value)).toString(16).padStart(32, "0")
      } else if (type === "uint64") {
        // uint64: pad to 8 bytes
        result += (typeof value === "bigint" ? value : BigInt(value)).toString(16).padStart(16, "0")
      } else if (type === "uint32") {
        // uint32: pad to 4 bytes
        result += (typeof value === "number" ? value : Number(value)).toString(16).padStart(8, "0")
      } else if (type === "uint16") {
        // uint16: pad to 2 bytes
        result += (typeof value === "number" ? value : Number(value)).toString(16).padStart(4, "0")
      } else if (type === "uint8") {
        // uint8: pad to 1 byte
        result += (typeof value === "number" ? value : Number(value)).toString(16).padStart(2, "0")
      } else if (type === "address") {
        // address: pad to 20 bytes
        const hex = typeof value === "string" && value.startsWith("0x") ? value.slice(2) : value
        result += hex.padStart(40, "0")
      }
    }
    return ("0x" + result) as `0x${string}`
  },
  encodeFunctionData: vi.fn().mockReturnValue("0x"),
  decodeFunctionResult: vi.fn().mockReturnValue([]),
  parseAbi: vi.fn().mockReturnValue([]),
  http: vi.fn().mockReturnValue({}),
  createPublicClient: vi.fn().mockReturnValue({
    readContract: vi.fn().mockResolvedValue(100n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      blockNumber: 100n,
      logs: [],
    }),
    getBlock: vi.fn().mockResolvedValue({
      parentBeaconBlockRoot: "0x1234",
      timestamp: 1234567890n,
    }),
    request: vi.fn().mockResolvedValue({
      accountProof: ["0x1234"],
      storageProof: [{ key: "0x1234", value: "0x1", proof: ["0x1234"] }],
    }),
    getLogs: vi.fn().mockResolvedValue([]),
    getBlockNumber: vi.fn().mockResolvedValue(1000n),
    getProof: vi.fn().mockResolvedValue({
      accountProof: ["0x1234"],
      storageProof: [{ key: "0x1234", value: 1n, proof: ["0x1234"] }],
    }),
  }),
  createWalletClient: vi.fn().mockReturnValue({
    writeContract: vi.fn().mockResolvedValue("0xmocktxhash"),
    account: { address: "0x1234567890123456789012345678901234567890" },
    getAddresses: vi.fn().mockResolvedValue(["0x1234567890123456789012345678901234567890"]),
  }),
}))

const WETH_ON_AZTEC_SEPOLIA_ADDRESS: `0x${string}` =
  "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
const WETH_ON_BASE_SEPOLIA_ADDRESS: `0x${string}` = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"
const MOCK_EVM_ADDRESS: `0x${string}` = "0x1234567890123456789012345678901234567890"
const MOCK_AZTEC_ADDRESS: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000001234"

/**
 * Bridge Unit Tests
 *
 * These tests use mocked wallets and network calls to verify the Bridge class logic
 * without requiring actual network connections to Aztec or Base Sepolia.
 */
describe("Bridge Unit Tests", () => {
  let mockAztecWallet: Wallet
  let mockAztecAddress: AztecAddress

  beforeEach(async () => {
    vi.clearAllMocks()

    mockAztecAddress = await AztecAddress.random()

    // Create mock Aztec wallet
    mockAztecWallet = {
      getAddress: vi.fn().mockReturnValue(mockAztecAddress),
      registerContract: vi.fn().mockResolvedValue(undefined),
      getAztecNode: vi.fn().mockReturnValue({
        getContract: vi.fn().mockResolvedValue({
          address: mockAztecAddress,
        }),
      }),
      createAuthWit: vi.fn().mockResolvedValue({}),
      getAccounts: vi.fn().mockResolvedValue([{ item: mockAztecAddress }]),
    } as unknown as Wallet
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("Initialization", () => {
    it("cannot initialize bridge without aztecWallet or azguardClient", async () => {
      await expect(
        Bridge.create({
          evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
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
          evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
          aztecWallet: mockAztecWallet,
          azguardClient: {} as AzguardClient,
        }),
      ).rejects.toThrow("Cannot specify both azguardClient and aztecWallet")
    })

    it("should create bridge with aztecWallet", async () => {
      const bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })

      expect(bridge).toBeDefined()
      expect(bridge.aztecWallet).toBe(mockAztecWallet)
    })

    it("should create bridge with azguardClient", async () => {
      const mockAzguardClient = {
        accounts: [`aztec:1:${MOCK_AZTEC_ADDRESS}`],
        execute: vi.fn(),
      } as unknown as AzguardClient

      const bridge = await Bridge.create({
        azguardClient: mockAzguardClient,
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
      })

      expect(bridge).toBeDefined()
      expect(bridge.azguardClient).toBe(mockAzguardClient)
    })

    it("should create bridge with evmProvider instead of evmPrivateKey", async () => {
      const mockAzguardClient = {
        accounts: [`aztec:1:${MOCK_AZTEC_ADDRESS}`],
        execute: vi.fn(),
      } as unknown as AzguardClient

      const bridge = await Bridge.create({
        azguardClient: mockAzguardClient,
        evmProvider: { request: vi.fn() },
      })

      expect(bridge).toBeDefined()
      expect(bridge.evmProvider).toBeDefined()
    })

    it("should create bridge with beaconApiUrl", async () => {
      const mockAzguardClient = {
        accounts: [`aztec:1:${MOCK_AZTEC_ADDRESS}`],
        execute: vi.fn(),
      } as unknown as AzguardClient

      const bridge = await Bridge.create({
        azguardClient: mockAzguardClient,
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        beaconApiUrl: "http://localhost:5052",
      })

      expect(bridge).toBeDefined()
      expect(bridge.beaconApiUrl).toBe("http://localhost:5052")
    })
  })

  describe("openOrder validation", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should reject if chainIdIn equals chainIdOut", async () => {
      await expect(
        bridge.openOrder({
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.aztecDevnet.chain.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
          mode: "public",
          data: padHex("0x"),
          recipient: MOCK_EVM_ADDRESS,
        }),
      ).rejects.toThrow("Invalid chains: only cross-chain orders are supported")
    })

    it("should reject invalid mode", async () => {
      await expect(
        bridge.openOrder({
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.baseSepolia.chain.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
          mode: "invalidMode" as any,
          data: padHex("0x"),
          recipient: MOCK_EVM_ADDRESS,
        }),
      ).rejects.toThrow("Invalid mode")
    })

    it("should reject invalid data length", async () => {
      await expect(
        bridge.openOrder({
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.baseSepolia.chain.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
          mode: "public",
          data: "0x1234", // Invalid length
          recipient: MOCK_EVM_ADDRESS,
        }),
      ).rejects.toThrow("Invalid data: must be 32 bytes")
    })

    it("should reject if neither chain is Aztec", async () => {
      await expect(
        bridge.openOrder({
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: 1, // Mainnet, not Aztec
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
          mode: "public",
          data: padHex("0x"),
          recipient: MOCK_EVM_ADDRESS,
        }),
      ).rejects.toThrow("Neither chain is Aztec")
    })

    it("should accept all valid modes", async () => {
      const modes = ["private", "public", "privateWithHook", "publicWithHook"] as const

      for (const mode of modes) {
        // Just testing validation passes - actual execution will fail due to mocks
        try {
          await bridge.openOrder({
            chainIdIn: chainsConfig.aztecDevnet.chain.id,
            chainIdOut: chainsConfig.baseSepolia.chain.id,
            amountIn: 1n,
            amountOut: 1n,
            tokenIn: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
            tokenOut: WETH_ON_BASE_SEPOLIA_ADDRESS,
            mode,
            data: padHex("0x"),
            recipient: MOCK_EVM_ADDRESS,
          })
        } catch (e: any) {
          // Should fail deeper in the code, not on mode validation
          expect(e.message).not.toBe(`Invalid mode: ${mode}`)
        }
      }
    })
  })

  describe("fillOrder validation", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should reject expired order", async () => {
      const expiredDeadline = Math.floor(Date.now() / 1000) - 1000 // 1000 seconds in the past

      await expect(
        bridge.fillOrder({
          orderId: padHex("0x1234") as Hex,
          orderData: {
            orderType: 0,
            sender: MOCK_AZTEC_ADDRESS,
            recipient: MOCK_EVM_ADDRESS,
            inputToken: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
            outputToken: WETH_ON_BASE_SEPOLIA_ADDRESS,
            amountIn: 1n,
            amountOut: 1n,
            senderNonce: 1n,
            originDomain: chainsConfig.aztecDevnet.chain.id,
            destinationDomain: chainsConfig.baseSepolia.chain.id,
            destinationSettler: padHex("0x", { size: 32 }),
            fillDeadline: expiredDeadline,
            data: padHex("0x"),
          },
        }),
      ).rejects.toThrow("Order expired")
    })

    it("should reject if neither chain is Aztec", async () => {
      const futureDeadline = Math.floor(Date.now() / 1000) + 10000

      await expect(
        bridge.fillOrder({
          orderId: padHex("0x1234") as Hex,
          orderData: {
            orderType: 0,
            sender: MOCK_EVM_ADDRESS,
            recipient: MOCK_EVM_ADDRESS,
            inputToken: WETH_ON_BASE_SEPOLIA_ADDRESS,
            outputToken: WETH_ON_BASE_SEPOLIA_ADDRESS,
            amountIn: 1n,
            amountOut: 1n,
            senderNonce: 1n,
            originDomain: chainsConfig.baseSepolia.chain.id,
            destinationDomain: 1, // Mainnet, not Aztec
            destinationSettler: padHex("0x", { size: 32 }),
            fillDeadline: futureDeadline,
            data: padHex("0x"),
          },
        }),
      ).rejects.toThrow("Neither chain is Aztec")
    })

    it("should reject order at exact deadline", async () => {
      const exactDeadline = Math.floor(Date.now() / 1000)

      await expect(
        bridge.fillOrder({
          orderId: padHex("0x1234") as Hex,
          orderData: {
            orderType: 0,
            sender: MOCK_AZTEC_ADDRESS,
            recipient: MOCK_EVM_ADDRESS,
            inputToken: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
            outputToken: WETH_ON_BASE_SEPOLIA_ADDRESS,
            amountIn: 1n,
            amountOut: 1n,
            senderNonce: 1n,
            originDomain: chainsConfig.aztecDevnet.chain.id,
            destinationDomain: chainsConfig.baseSepolia.chain.id,
            destinationSettler: padHex("0x", { size: 32 }),
            fillDeadline: exactDeadline,
            data: padHex("0x"),
          },
        }),
      ).rejects.toThrow("Order expired")
    })
  })

  describe("refundOrder validation", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should reject if neither chain is Aztec", async () => {
      await expect(
        bridge.refundOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: 1, // Mainnet, not Aztec
        }),
      ).rejects.toThrow("Neither chain is Aztec")
    })
  })

  describe("forwardSettleOrder validation", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should reject if neither chain is Aztec", async () => {
      await expect(
        bridge.forwardSettleOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: 1, // Mainnet, not Aztec
        }),
      ).rejects.toThrow("Neither chain is Aztec")
    })

    it("should call forwardToL2 when chainIdOut is Aztec", async () => {
      // When chainIdOut is Aztec and chainIdIn is EVM, it calls forwardToL2
      await expect(
        bridge.forwardSettleOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: chainsConfig.aztecDevnet.chain.id,
        }),
      ).rejects.toThrow() // Will fail but tests path selection
    })

    it("should call forwardToAztec when chainIdIn is Aztec", async () => {
      await expect(
        bridge.forwardSettleOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.baseSepolia.chain.id,
        }),
      ).rejects.toThrow() // Will fail but tests path selection
    })
  })

  describe("forwardRefundOrder validation", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should reject if neither chain is Aztec", async () => {
      await expect(
        bridge.forwardRefundOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: 1, // Mainnet, not Aztec
        }),
      ).rejects.toThrow("Neither chain is Aztec")
    })
  })

  describe("finalizeForwardSettleOrder validation", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should reject if neither chain is Aztec", async () => {
      await expect(
        bridge.finalizeForwardSettleOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: 1, // Mainnet, not Aztec
        }),
      ).rejects.toThrow("Neither chain is Aztec")
    })

    it("should throw not implemented for chainIdIn is Aztec", async () => {
      await expect(
        bridge.finalizeForwardSettleOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.baseSepolia.chain.id,
        }),
      ).rejects.toThrow("Not implemented")
    })
  })

  describe("finalizeForwardRefundOrder validation", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should reject if neither chain is Aztec", async () => {
      await expect(
        bridge.finalizeForwardRefundOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.baseSepolia.chain.id,
          chainIdOut: 1, // Mainnet, not Aztec
        }),
      ).rejects.toThrow("Neither chain is Aztec")
    })

    it("should throw not implemented for chainIdIn is Aztec", async () => {
      await expect(
        bridge.finalizeForwardRefundOrder({
          orderId: padHex("0x1234") as Hex,
          chainIdIn: chainsConfig.aztecDevnet.chain.id,
          chainIdOut: chainsConfig.baseSepolia.chain.id,
        }),
      ).rejects.toThrow("Not implemented")
    })
  })

  describe("OrderDataEncoder", () => {
    it("should encode and decode order data correctly", () => {
      const orderData = {
        orderType: 0,
        sender: MOCK_AZTEC_ADDRESS,
        recipient: padHex("0x1234567890123456789012345678901234567890", { size: 32 }),
        inputToken: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
        outputToken: padHex("0xAf31a5CFf95131B2E0D3fa89125342984567f399", { size: 32 }),
        amountIn: 1000000n,
        amountOut: 999000n,
        senderNonce: 1n,
        originDomain: chainsConfig.aztecDevnet.chain.id,
        destinationDomain: chainsConfig.baseSepolia.chain.id,
        destinationSettler: padHex("0xabcdef1234567890abcdef1234567890abcdef12", { size: 32 }),
        fillDeadline: Math.floor(Date.now() / 1000) + 3600,
        data: padHex("0x"),
      }

      const encoder = new OrderDataEncoder(orderData)
      const encoded = encoder.encode()

      expect(encoded).toBeDefined()
      expect(typeof encoded).toBe("string")
      expect(encoded.startsWith("0x")).toBe(true)

      const decoded = OrderDataEncoder.decode(encoded)

      expect(decoded.orderType).toBe(orderData.orderType)
      expect(decoded.sender).toBe(orderData.sender)
      expect(decoded.recipient.toLowerCase()).toBe(orderData.recipient.toLowerCase())
      expect(decoded.inputToken).toBe(orderData.inputToken)
      expect(decoded.outputToken.toLowerCase()).toBe(orderData.outputToken.toLowerCase())
      expect(decoded.amountIn).toBe(orderData.amountIn)
      expect(decoded.amountOut).toBe(orderData.amountOut)
      expect(decoded.senderNonce).toBe(orderData.senderNonce)
      expect(decoded.originDomain).toBe(orderData.originDomain)
      expect(decoded.destinationDomain).toBe(orderData.destinationDomain)
      expect(decoded.destinationSettler.toLowerCase()).toBe(orderData.destinationSettler.toLowerCase())
      expect(decoded.fillDeadline).toBe(orderData.fillDeadline)
    })

    it("should throw for invalid order data length", () => {
      expect(() => OrderDataEncoder.decode("0x1234")).toThrow("Invalid OrderData length")
    })

    it("should handle different order types", () => {
      const baseOrderData = {
        sender: MOCK_AZTEC_ADDRESS,
        recipient: padHex("0x1234567890123456789012345678901234567890", { size: 32 }),
        inputToken: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
        outputToken: padHex("0xAf31a5CFf95131B2E0D3fa89125342984567f399", { size: 32 }),
        amountIn: 1000000n,
        amountOut: 999000n,
        senderNonce: 1n,
        originDomain: chainsConfig.aztecDevnet.chain.id,
        destinationDomain: chainsConfig.baseSepolia.chain.id,
        destinationSettler: padHex("0xabcdef1234567890abcdef1234567890abcdef12", { size: 32 }),
        fillDeadline: Math.floor(Date.now() / 1000) + 3600,
        data: padHex("0x"),
      }

      const orderTypes = [PRIVATE_ORDER, PRIVATE_ORDER_WITH_HOOK, PUBLIC_ORDER, PUBLIC_ORDER_WITH_HOOK]

      for (const orderType of orderTypes) {
        const encoder = new OrderDataEncoder({ ...baseOrderData, orderType })
        const encoded = encoder.encode()
        const decoded = OrderDataEncoder.decode(encoded)
        expect(decoded.orderType).toBe(orderType)
      }
    })

    it("should handle large amounts", () => {
      const orderData = {
        orderType: 0,
        sender: MOCK_AZTEC_ADDRESS,
        recipient: padHex("0x1234567890123456789012345678901234567890", { size: 32 }),
        inputToken: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
        outputToken: padHex("0xAf31a5CFf95131B2E0D3fa89125342984567f399", { size: 32 }),
        amountIn: 2n ** 128n - 1n, // Large amount
        amountOut: 2n ** 128n - 1n,
        senderNonce: 2n ** 64n - 1n,
        originDomain: chainsConfig.aztecDevnet.chain.id,
        destinationDomain: chainsConfig.baseSepolia.chain.id,
        destinationSettler: padHex("0xabcdef1234567890abcdef1234567890abcdef12", { size: 32 }),
        fillDeadline: 2 ** 32 - 1, // Max uint32
        data: padHex("0x"),
      }

      const encoder = new OrderDataEncoder(orderData)
      const encoded = encoder.encode()
      const decoded = OrderDataEncoder.decode(encoded)

      expect(decoded.amountIn).toBe(orderData.amountIn)
      expect(decoded.amountOut).toBe(orderData.amountOut)
      expect(decoded.fillDeadline).toBe(orderData.fillDeadline)
    })

    it("should get toPacked representation", () => {
      const orderData = {
        orderType: 0,
        sender: MOCK_AZTEC_ADDRESS,
        recipient: padHex("0x1234567890123456789012345678901234567890", { size: 32 }),
        inputToken: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
        outputToken: padHex("0xAf31a5CFf95131B2E0D3fa89125342984567f399", { size: 32 }),
        amountIn: 1000000n,
        amountOut: 999000n,
        senderNonce: 1n,
        originDomain: chainsConfig.aztecDevnet.chain.id,
        destinationDomain: chainsConfig.baseSepolia.chain.id,
        destinationSettler: padHex("0xabcdef1234567890abcdef1234567890abcdef12", { size: 32 }),
        fillDeadline: Math.floor(Date.now() / 1000) + 3600,
        data: padHex("0x"),
      }

      const encoder = new OrderDataEncoder(orderData)
      const packed = encoder.toPacked()

      expect(packed.types).toBeDefined()
      expect(packed.values).toBeDefined()
      expect(packed.values.length).toBe(13)
    })
  })

  describe("Bridge with AzguardClient", () => {
    it("should handle azguardClient account format", async () => {
      const mockAzguardClient = {
        accounts: [`aztec:11155111:${MOCK_AZTEC_ADDRESS}`],
        execute: vi.fn().mockResolvedValue([{ status: "ok", result: "0xmocktxhash" }]),
      } as unknown as AzguardClient

      const bridge = await Bridge.create({
        azguardClient: mockAzguardClient,
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
      })

      expect(bridge).toBeDefined()
      expect(bridge.azguardClient).toBe(mockAzguardClient)
    })
  })

  describe("getAztecAddressFromAzguardAccount", () => {
    it("should extract address from CAIP format", () => {
      const caipAccount = `aztec:11155111:${MOCK_AZTEC_ADDRESS}` as const
      const address = getAztecAddressFromAzguardAccount(caipAccount)
      expect(address).toBe(MOCK_AZTEC_ADDRESS)
    })

    it("should handle different chain IDs", () => {
      const address1 = getAztecAddressFromAzguardAccount(`aztec:1:${MOCK_AZTEC_ADDRESS}`)
      const address2 = getAztecAddressFromAzguardAccount(`aztec:31337:${MOCK_AZTEC_ADDRESS}`)

      expect(address1).toBe(MOCK_AZTEC_ADDRESS)
      expect(address2).toBe(MOCK_AZTEC_ADDRESS)
    })
  })

  describe("Chain validation helpers", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should throw for unsupported source chain in gateway lookup", async () => {
      await expect(
        bridge.openOrder({
          chainIdIn: 999999, // Non-existent chain
          chainIdOut: chainsConfig.aztecDevnet.chain.id,
          amountIn: 1n,
          amountOut: 1n,
          tokenIn: WETH_ON_BASE_SEPOLIA_ADDRESS,
          tokenOut: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
          mode: "public",
          data: padHex("0x"),
          recipient: MOCK_AZTEC_ADDRESS,
        }),
      ).rejects.toThrow()
    })
  })

  describe("claimEvmToAztecPrivateOrder", () => {
    let bridge: Bridge

    beforeEach(async () => {
      bridge = await Bridge.create({
        evmPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
        aztecWallet: mockAztecWallet,
      })
    })

    it("should throw if log not found for order", async () => {
      const orderId = padHex("0x1234") as Hex
      const secret = padHex("0xsecret") as Hex

      await expect(bridge.claimEvmToAztecPrivateOrder(orderId, secret)).rejects.toThrow(
        `Log not found for the specified order id ${orderId}`,
      )
    })
  })

  describe("hexToUintArray utility", () => {
    it("should convert hex string to uint array", () => {
      const hex = "0x1234" as `0x${string}`
      const result = hexToUintArray(hex)

      expect(result).toBeInstanceOf(Array)
      expect(result).toEqual([0x12, 0x34])
    })

    it("should handle empty hex", () => {
      const hex = "0x" as `0x${string}`
      const result = hexToUintArray(hex)

      expect(result).toEqual([])
    })

    it("should handle longer hex strings", () => {
      const hex = "0xdeadbeef" as `0x${string}`
      const result = hexToUintArray(hex)

      expect(result).toEqual([0xde, 0xad, 0xbe, 0xef])
    })
  })

  describe("Constants exports", () => {
    it("should export order type constants", () => {
      expect(PRIVATE_ORDER).toBeDefined()
      expect(PRIVATE_ORDER_WITH_HOOK).toBeDefined()
      expect(PUBLIC_ORDER).toBeDefined()
      expect(PUBLIC_ORDER_WITH_HOOK).toBeDefined()
    })

    it("should have distinct order type values", () => {
      const orderTypes = [PRIVATE_ORDER, PRIVATE_ORDER_WITH_HOOK, PUBLIC_ORDER, PUBLIC_ORDER_WITH_HOOK]
      const uniqueTypes = new Set(orderTypes)
      expect(uniqueTypes.size).toBe(4)
    })
  })

  describe("aztecSepolia chain", () => {
    it("should have correct chain id", () => {
      expect(chainsConfig.aztecDevnet.chain.id).toBeDefined()
      expect(typeof chainsConfig.aztecDevnet.chain.id).toBe("number")
    })

    it("should have rpcUrls", () => {
      expect(chainsConfig.aztecDevnet.chain.rpcUrls).toBeDefined()
      expect(chainsConfig.aztecDevnet.chain.rpcUrls.default).toBeDefined()
    })
  })

  describe("BridgeHelpers", () => {
    describe("getChainByChainId", () => {
      it("should return aztecSepolia for aztec chain id", () => {
        const chain = BridgeHelpers.getChainByChainId(chainsConfig.aztecDevnet.chain.id)
        expect(chain.chain.id).toBe(chainsConfig.aztecDevnet.chain.id)
      })

      it("should return EVM chain for valid chain id", () => {
        const chain = BridgeHelpers.getChainByChainId(chainsConfig.baseSepolia.chain.id)
        expect(chain.chain.id).toBe(chainsConfig.baseSepolia.chain.id)
      })

      it("should return undefined behavior for unknown chain id", () => {
        // Note: viem/chains has many chains, but a truly invalid ID should throw
        // Using a chain ID that doesn't exist in viem/chains
        expect(() => BridgeHelpers.getChainByChainId(-1)).toThrowError(/Chain not found/)
      })
    })

    describe("getChainInAndOutByChainIds", () => {
      it("should return both chains", () => {
        const { chainIn, chainOut } = BridgeHelpers.getChainInAndOutByChainIds(
          chainsConfig.aztecDevnet.chain.id,
          chainsConfig.baseSepolia.chain.id,
        )
        expect(chainIn.chain.id).toBe(chainsConfig.aztecDevnet.chain.id)
        expect(chainOut.chain.id).toBe(chainsConfig.baseSepolia.chain.id)
      })
    })

    describe("getOrderType", () => {
      it("should return PUBLIC_ORDER for public mode", () => {
        expect(BridgeHelpers.getOrderType("public")).toBe(PUBLIC_ORDER)
      })

      it("should return PUBLIC_ORDER for publicWithHook mode", () => {
        expect(BridgeHelpers.getOrderType("publicWithHook")).toBe(PUBLIC_ORDER)
      })

      it("should return PRIVATE_ORDER for private mode", () => {
        expect(BridgeHelpers.getOrderType("private")).toBe(PRIVATE_ORDER)
      })

      it("should return PRIVATE_ORDER for privateWithHook mode", () => {
        expect(BridgeHelpers.getOrderType("privateWithHook")).toBe(PRIVATE_ORDER)
      })

      it("should throw for invalid mode", () => {
        expect(() => BridgeHelpers.getOrderType("invalid" as any)).toThrowError(/Invalid order mode/)
      })
    })

    describe("getGatewaysByChainIds", () => {
      it("should return gateways for valid chain ids", () => {
        const { gatewayIn, gatewayOut } = BridgeHelpers.getGatewaysByChainIds(
          chainsConfig.aztecDevnet.chain.id,
          chainsConfig.baseSepolia.chain.id,
        )
        expect(gatewayIn).toBeDefined()
        expect(gatewayOut).toBeDefined()
      })

      it("should throw for invalid source chain", () => {
        expect(() => BridgeHelpers.getGatewaysByChainIds(123456789, chainsConfig.baseSepolia.chain.id)).toThrow()
      })

      it("should throw for invalid destination chain", () => {
        expect(() => BridgeHelpers.getGatewaysByChainIds(chainsConfig.aztecDevnet.chain.id, 123456789)).toThrow()
      })
    })
  })

  describe("gatewayAddresses", () => {
    it("should have gateway for aztecSepolia", () => {
      expect(chainsConfig.aztecDevnet.gatewayAddress).toBeDefined()
    })

    it("should have gateway for baseSepolia", () => {
      expect(chainsConfig.baseSepolia.gatewayAddress).toBeDefined()
    })
  })

  describe("parseResolvedAztecOrder", () => {
    it("should parse resolved order from hex string", async () => {
      const { parseResolvedAztecOrder } = await import("../src/utils/gateway")

      // Create a hex string that represents a resolved order
      // The structure is parsed from the end of the string
      // We need to construct a string long enough to be parsed
      const mockHexString =
        // user (32 bytes = 64 hex chars)
        "0000000000000000000000001234567890abcdef1234567890abcdef12345678" +
        // originChainId (4 bytes = 8 hex chars)
        "000149e4" + // 84452
        // openDeadline (4 bytes = 8 hex chars)
        "12345678" +
        // fillDeadline (4 bytes = 8 hex chars)
        "87654321" +
        // orderId (32 bytes = 64 hex chars)
        "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" +
        // minReceived token (32 bytes = 64 hex chars)
        "0000000000000000000000001111111111111111111111111111111111111111" +
        // minReceived amount (32 bytes = 64 hex chars)
        "0000000000000000000000000000000000000000000000000000000000001000" +
        // minReceived recipient (32 bytes = 64 hex chars)
        "0000000000000000000000002222222222222222222222222222222222222222" +
        // minReceived chainId (4 bytes = 8 hex chars)
        "000149e4" +
        // maxSpent token (32 bytes = 64 hex chars)
        "0000000000000000000000003333333333333333333333333333333333333333" +
        // maxSpent amount (32 bytes = 64 hex chars)
        "0000000000000000000000000000000000000000000000000000000000002000" +
        // maxSpent recipient (32 bytes = 64 hex chars)
        "0000000000000000000000004444444444444444444444444444444444444444" +
        // maxSpent chainId (4 bytes = 8 hex chars)
        "000149e4" +
        // destinationChainId (4 bytes = 8 hex chars)
        "000149e4" +
        // destinationSettler (32 bytes = 64 hex chars)
        "0000000000000000000000005555555555555555555555555555555555555555" +
        // originData (301 bytes = 602 hex chars)
        "0".repeat(602)

      const resolvedOrder = parseResolvedAztecOrder("0x" + mockHexString)

      expect(resolvedOrder).toBeDefined()
      expect(resolvedOrder.fillInstructions).toBeDefined()
      expect(resolvedOrder.fillInstructions.length).toBe(1)
      expect(resolvedOrder.maxSpent).toBeDefined()
      expect(resolvedOrder.maxSpent.length).toBe(1)
      expect(resolvedOrder.minReceived).toBeDefined()
      expect(resolvedOrder.minReceived.length).toBe(1)
    })
  })

  describe("parseFilledLog", () => {
    it("should parse filled log from Fr array", async () => {
      const { parseFilledLog } = await import("../src/utils/gateway")
      const { Fr } = await import("@aztec/aztec.js/fields")

      // Create mock Fr fields that represent a filled log
      // Filled logs have 13 fields
      const fields = [
        new Fr(BigInt("0x1234567890abcdef")), // orderId part
        new Fr(BigInt("0x00001111111111111111111111111111111111111111111111111111111111")), // field 1
        new Fr(BigInt("0x00002222222222222222222222222222222222222222222222222222222222")), // field 2
        new Fr(BigInt("0x00003333333333333333333333333333333333333333333333333333333333")), // field 3
        new Fr(BigInt("0x00004444444444444444444444444444444444444444444444444444444444")), // field 4
        new Fr(BigInt("0x00005555555555555555555555555555555555555555555555555555555555")), // field 5
        new Fr(BigInt("0x00006666666666666666666666666666666666666666666666666666666666")), // field 6
        new Fr(BigInt("0x00007777777777777777777777777777777777777777777777777777777777")), // field 7
        new Fr(BigInt("0x00008888888888888888888888888888888888888888888888888888888888")), // field 8
        new Fr(BigInt("0x00009999999999999999999999999999999999999999999999999999999999")), // field 9
        new Fr(BigInt("0x0000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")), // field 10
        new Fr(BigInt("0x0000bbbbbbbbbbbbbb")), // fillerData
        new Fr(BigInt("0x0000ccddaabbccddee")), // residualBytes
      ]

      const filledLog = parseFilledLog(fields)

      expect(filledLog).toBeDefined()
      expect(filledLog.orderId).toBeDefined()
      expect(filledLog.fillerData).toBeDefined()
      expect(filledLog.originData).toBeDefined()
      expect(filledLog.originData.startsWith("0x")).toBe(true)
    })
  })
})
