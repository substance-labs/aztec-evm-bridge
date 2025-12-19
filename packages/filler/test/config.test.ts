import { describe, it, expect } from "vitest"
import {
  config,
  isEvmChainConfig,
  isAztecChainConfig,
  getChainConfig,
  isTokenSupported,
  ChainConfigType,
} from "../src/config.js"

describe("config", () => {
  describe("isEvmChainConfig", () => {
    it("should return true for EVM chain config", () => {
      const evmConfig = config.chains.baseSepolia
      expect(isEvmChainConfig(evmConfig)).toBe(true)
    })

    it("should return false for Aztec chain config", () => {
      const aztecConfig = config.chains.aztec
      expect(isEvmChainConfig(aztecConfig)).toBe(false)
    })
  })

  describe("isAztecChainConfig", () => {
    it("should return true for Aztec chain config", () => {
      const aztecConfig = config.chains.aztec
      expect(isAztecChainConfig(aztecConfig)).toBe(true)
    })

    it("should return false for EVM chain config", () => {
      const evmConfig = config.chains.baseSepolia
      expect(isAztecChainConfig(evmConfig)).toBe(false)
    })
  })

  describe("getChainConfig", () => {
    it("should return chain config by name (case insensitive)", () => {
      const aztecConfig = getChainConfig("aztec")
      expect(aztecConfig).toBeDefined()
      expect(aztecConfig.type).toBe(ChainConfigType.AZTEC)

      const aztecConfigUpper = getChainConfig("AZTEC")
      expect(aztecConfigUpper).toBeDefined()
      expect(aztecConfigUpper.type).toBe(ChainConfigType.AZTEC)
    })

    it("should throw error if chain config not found", () => {
      expect(() => getChainConfig("unknown")).toThrow("Chain config not found for chain name: unknown")
    })
  })

  describe("isTokenSupported", () => {
    it("should return true if token is supported (case insensitive)", () => {
      const chainConfig = config.chains.baseSepolia
      const tokenAddress = chainConfig.tokens[0].address
      expect(isTokenSupported(chainConfig, tokenAddress)).toBe(true)
      expect(isTokenSupported(chainConfig, tokenAddress.toLowerCase())).toBe(true)
      expect(isTokenSupported(chainConfig, tokenAddress.toUpperCase())).toBe(true)
    })

    it("should return false if token is not supported", () => {
      const chainConfig = config.chains.baseSepolia
      expect(isTokenSupported(chainConfig, "0x0000000000000000000000000000000000000000")).toBe(false)
    })
  })
})
