import { describe, expect, it, vi } from "vitest"
import { AzguardClient } from "@azguardwallet/client"
import { Bridge, getAztecAddressFromAzguardAccount } from "../src"

/**
 * Mock Azguard Wallet Tests
 *
 * These tests use mocked AzguardClient to verify error handling and validation logic
 * without requiring a full Azguard wallet setup. This helps improve code coverage
 * for Azguard-specific paths in the Bridge class.
 */
describe("Bridge with Mocked Azguard", () => {
  describe("Initialization with Azguard", () => {
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

    it("should reject when both aztecWallet and azguardClient are provided", async () => {
      const mockAzguardClient = {} as AzguardClient

      await expect(
        Bridge.create({
          azguardClient: mockAzguardClient,
          aztecWallet: {} as any,
          evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
        }),
      ).rejects.toThrow("Cannot specify both azguardClient and aztecWallet")
    })

    it("should reject when neither aztecWallet nor azguardClient is provided", async () => {
      await expect(
        Bridge.create({
          evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
        }),
      ).rejects.toThrow("You must specify aztecWallet or azguardClient")
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
})
