import { describe, expect, it } from "vitest"
import { padHex } from "viem"

import {
  Bridge,
  OrderDataEncoder,
  BridgeHelpers,
  chainsConfig,
  getAztecAddressFromAzguardAccount,
  hexToUintArray,
  PRIVATE_ORDER,
  PRIVATE_ORDER_WITH_HOOK,
  PUBLIC_ORDER,
  PUBLIC_ORDER_WITH_HOOK,
  PRIVATE_SENDER,
  ORDER_DATA_TYPE,
  REFUND_ORDER_TYPE,
  SETTLE_ORDER_TYPE,
  OPENED,
  FILLED,
  FILLED_PRIVATELY,
  AZTEC_VERSION,
  type OrderData,
} from "../src"

const hex32 = (value: string) => ("0x" + value.padStart(64, "0").slice(-64)) as `0x${string}`

const WETH_ON_AZTEC_SEPOLIA_ADDRESS: `0x${string}` =
  "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
const WETH_ON_BASE_SEPOLIA_ADDRESS: `0x${string}` = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"
const MOCK_AZTEC_ADDRESS: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000001234"
const MOCK_EVM_ADDRESS: `0x${string}` = "0x1234567890123456789012345678901234567890"

/**
 * Bridge Unit Tests (Browser)
 *
 * These tests verify utility functions, helpers, and Aztec primitives in a browser environment.
 * Includes tests for @aztec/aztec.js WASM-based types (AztecAddress, Fr) which are key SDK dependencies.
 * Bridge.create tests are skipped since they involve complex async initialization.
 */
describe("Bridge Unit Tests (browser)", () => {
  describe("OrderDataEncoder", () => {
    const sampleOrder: OrderData = {
      sender: hex32("1"),
      recipient: hex32("2"),
      inputToken: hex32("3"),
      outputToken: hex32("4"),
      amountIn: 123456789n,
      amountOut: 987654321n,
      senderNonce: 42n,
      originDomain: 111,
      destinationDomain: 222,
      destinationSettler: hex32("5"),
      fillDeadline: 600,
      orderType: 1,
      data: hex32("6"),
    }

    it("encodes and decodes symmetrically", () => {
      const encoder = new OrderDataEncoder(sampleOrder)
      const encoded = encoder.encode()
      const decoded = OrderDataEncoder.decode(encoded)

      expect(decoded).toEqual(sampleOrder)
    })

    it("returns ABI-ready packed tuples", () => {
      const encoder = new OrderDataEncoder(sampleOrder)
      const packed = encoder.toPacked()

      expect(packed.types).toHaveLength(13)
      expect(packed.values[0]).toBe(sampleOrder.sender)
      expect(packed.values[5]).toBe(sampleOrder.amountOut)
    })

    it("throws for invalid order data length", () => {
      expect(() => OrderDataEncoder.decode("0x1234")).toThrow("Invalid OrderData length")
    })

    it("should encode and decode order data correctly", () => {
      const orderData: OrderData = {
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

    it("should handle different order types", () => {
      const baseOrderData: OrderData = {
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
        orderType: 0,
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
      const orderData: OrderData = {
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
      const orderData: OrderData = {
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

    it("should handle zero values", () => {
      const orderData: OrderData = {
        orderType: 0,
        sender: padHex("0x0", { size: 32 }),
        recipient: padHex("0x0", { size: 32 }),
        inputToken: padHex("0x0", { size: 32 }),
        outputToken: padHex("0x0", { size: 32 }),
        amountIn: 0n,
        amountOut: 0n,
        senderNonce: 0n,
        originDomain: 0,
        destinationDomain: 0,
        destinationSettler: padHex("0x0", { size: 32 }),
        fillDeadline: 0,
        data: padHex("0x0", { size: 32 }),
      }

      const encoder = new OrderDataEncoder(orderData)
      const encoded = encoder.encode()
      const decoded = OrderDataEncoder.decode(encoded)

      expect(decoded.amountIn).toBe(0n)
      expect(decoded.amountOut).toBe(0n)
      expect(decoded.orderType).toBe(0)
    })

    it("should preserve data field correctly", () => {
      const customData = padHex("0xdeadbeef1234567890abcdef", { size: 32 })
      const orderData: OrderData = {
        orderType: 1,
        sender: MOCK_AZTEC_ADDRESS,
        recipient: padHex(MOCK_EVM_ADDRESS, { size: 32 }),
        inputToken: WETH_ON_AZTEC_SEPOLIA_ADDRESS,
        outputToken: padHex(WETH_ON_BASE_SEPOLIA_ADDRESS, { size: 32 }),
        amountIn: 100n,
        amountOut: 99n,
        senderNonce: 5n,
        originDomain: chainsConfig.aztecDevnet.chain.id,
        destinationDomain: chainsConfig.baseSepolia.chain.id,
        destinationSettler: padHex("0x0", { size: 32 }),
        fillDeadline: 1000000,
        data: customData,
      }

      const encoder = new OrderDataEncoder(orderData)
      const encoded = encoder.encode()
      const decoded = OrderDataEncoder.decode(encoded)

      expect(decoded.data.toLowerCase()).toBe(customData.toLowerCase())
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

      it("should throw for unknown chain id", () => {
        expect(() => BridgeHelpers.getChainByChainId(-1)).toThrowError(/Chain not found/)
      })

      it("should throw for random invalid chain id", () => {
        expect(() => BridgeHelpers.getChainByChainId(99999999)).toThrowError(/Chain not found/)
      })
    })

    describe("getChainInAndOutByChainIds", () => {
      it("should return both chains for Aztec to EVM", () => {
        const { chainIn, chainOut } = BridgeHelpers.getChainInAndOutByChainIds(
          chainsConfig.aztecDevnet.chain.id,
          chainsConfig.baseSepolia.chain.id,
        )
        expect(chainIn.chain.id).toBe(chainsConfig.aztecDevnet.chain.id)
        expect(chainOut.chain.id).toBe(chainsConfig.baseSepolia.chain.id)
      })

      it("should return both chains for EVM to Aztec", () => {
        const { chainIn, chainOut } = BridgeHelpers.getChainInAndOutByChainIds(
          chainsConfig.baseSepolia.chain.id,
          chainsConfig.aztecDevnet.chain.id,
        )
        expect(chainIn.chain.id).toBe(chainsConfig.baseSepolia.chain.id)
        expect(chainOut.chain.id).toBe(chainsConfig.aztecDevnet.chain.id)
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
      it("should return gateways for Aztec to Base Sepolia", () => {
        const { gatewayIn, gatewayOut } = BridgeHelpers.getGatewaysByChainIds(
          chainsConfig.aztecDevnet.chain.id,
          chainsConfig.baseSepolia.chain.id,
        )
        expect(gatewayIn).toBeDefined()
        expect(gatewayOut).toBeDefined()
        expect(gatewayIn.startsWith("0x")).toBe(true)
        expect(gatewayOut.startsWith("0x")).toBe(true)
      })

      it("should return gateways for Base Sepolia to Aztec", () => {
        const { gatewayIn, gatewayOut } = BridgeHelpers.getGatewaysByChainIds(
          chainsConfig.baseSepolia.chain.id,
          chainsConfig.aztecDevnet.chain.id,
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

      it("should throw for both chains invalid", () => {
        expect(() => BridgeHelpers.getGatewaysByChainIds(111111, 222222)).toThrow()
      })
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

    it("should handle long chain IDs", () => {
      const address = getAztecAddressFromAzguardAccount(`aztec:999999999:${MOCK_AZTEC_ADDRESS}`)
      expect(address).toBe(MOCK_AZTEC_ADDRESS)
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

    it("should handle single byte", () => {
      const hex = "0xff" as `0x${string}`
      const result = hexToUintArray(hex)

      expect(result).toEqual([0xff])
    })

    it("should handle full 32-byte address", () => {
      const hex = MOCK_AZTEC_ADDRESS
      const result = hexToUintArray(hex)

      expect(result.length).toBe(32)
      expect(result[result.length - 1]).toBe(0x34)
      expect(result[result.length - 2]).toBe(0x12)
    })
  })

  describe("Constants exports", () => {
    describe("Order type constants", () => {
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

      it("should have correct order type values", () => {
        expect(PUBLIC_ORDER).toBe(0)
        expect(PRIVATE_ORDER).toBe(1)
        expect(PUBLIC_ORDER_WITH_HOOK).toBe(2)
        expect(PRIVATE_ORDER_WITH_HOOK).toBe(3)
      })
    })

    describe("Order status constants", () => {
      it("should export order status constants", () => {
        expect(OPENED).toBeDefined()
        expect(FILLED).toBeDefined()
        expect(FILLED_PRIVATELY).toBeDefined()
      })

      it("should have correct order status values", () => {
        expect(OPENED).toBe(1)
        expect(FILLED).toBe(2)
        expect(FILLED_PRIVATELY).toBe(3)
      })
    })

    describe("Type hash constants", () => {
      it("should export type hash constants", () => {
        expect(ORDER_DATA_TYPE).toBeDefined()
        expect(REFUND_ORDER_TYPE).toBeDefined()
        expect(SETTLE_ORDER_TYPE).toBeDefined()
      })

      it("should have valid hex format for type hashes", () => {
        expect(ORDER_DATA_TYPE.startsWith("0x")).toBe(true)
        expect(REFUND_ORDER_TYPE.startsWith("0x")).toBe(true)
        expect(SETTLE_ORDER_TYPE.startsWith("0x")).toBe(true)
      })

      it("should have 32-byte type hashes", () => {
        // 32 bytes = 64 hex chars + 0x prefix = 66 chars
        expect(ORDER_DATA_TYPE.length).toBe(66)
        expect(REFUND_ORDER_TYPE.length).toBe(66)
        expect(SETTLE_ORDER_TYPE.length).toBe(66)
      })
    })

    describe("Other constants", () => {
      it("should export PRIVATE_SENDER", () => {
        expect(PRIVATE_SENDER).toBeDefined()
        expect(PRIVATE_SENDER.startsWith("0x")).toBe(true)
      })

      it("should export AZTEC_VERSION", () => {
        expect(AZTEC_VERSION).toBeDefined()
        expect(typeof AZTEC_VERSION).toBe("number")
      })
    })
  })

  describe("aztecSepolia chain", () => {
    it("should have correct chain id", () => {
      expect(chainsConfig.aztecDevnet.chain.id).toBeDefined()
      expect(typeof chainsConfig.aztecDevnet.chain.id).toBe("number")
      expect(chainsConfig.aztecDevnet.chain.id).toBe(999999)
    })

    it("should have rpcUrls", () => {
      expect(chainsConfig.aztecDevnet.chain.rpcUrls).toBeDefined()
      expect(chainsConfig.aztecDevnet.chain.rpcUrls.default).toBeDefined()
      expect(chainsConfig.aztecDevnet.chain.rpcUrls.default.http).toBeDefined()
      expect(chainsConfig.aztecDevnet.chain.rpcUrls.default.http.length).toBeGreaterThan(0)
    })

    it("should have name", () => {
      expect(chainsConfig.aztecDevnet.chain.name).toBeDefined()
      expect(chainsConfig.aztecDevnet.chain.name).toBe("Aztec Sepolia")
    })
  })

  describe("gatewayAddresses", () => {
    it("should have gateway for aztecSepolia", () => {
      expect(chainsConfig.aztecDevnet.gatewayAddress).toBeDefined()
      expect(chainsConfig.aztecDevnet.gatewayAddress.startsWith("0x")).toBe(true)
    })

    it("should have gateway for baseSepolia", () => {
      expect(chainsConfig.baseSepolia.gatewayAddress).toBeDefined()
      expect(chainsConfig.baseSepolia.gatewayAddress.startsWith("0x")).toBe(true)
    })

    it("should have different gateways for each chain", () => {
      expect(chainsConfig.aztecDevnet.gatewayAddress).not.toBe(chainsConfig.baseSepolia.gatewayAddress)
    })
  })

  describe("Bridge initialization (browser)", () => {
    const SAMPLE_PRIVATE_KEY = hex32("1")

    it("requires aztecWallet or azguardClient", async () => {
      await expect(Bridge.create({ evmPrivateKey: SAMPLE_PRIVATE_KEY })).rejects.toThrow(
        "You must specify aztecWallet or azguardClient",
      )
    })

    it("prevents specifying both evmPrivateKey and evmProvider", async () => {
      await expect(
        Bridge.create({
          evmPrivateKey: SAMPLE_PRIVATE_KEY,
          azguardClient: {} as never,
          evmProvider: {},
        }),
      ).rejects.toThrow("Cannot specify both evmPrivateKey and evmProvider")
    })

    it("prevents mixing azguard client with wallet", async () => {
      await expect(
        Bridge.create({
          evmPrivateKey: SAMPLE_PRIVATE_KEY,
          aztecWallet: {} as never,
          azguardClient: {} as never,
        }),
      ).rejects.toThrow("Cannot specify both azguardClient and aztecWallet")
    })
  })
})
