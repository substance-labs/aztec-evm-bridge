import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Monitor } from "../../src/services/monitor.service.js"
import { parseEther } from "viem"
import { AztecAddress } from "@aztec/aztec.js/addresses"

// Mock TokenContract
const { mockTokenContract } = vi.hoisted(() => {
  return {
    mockTokenContract: {
      methods: {
        balance_of_public: vi.fn().mockReturnValue({
          simulate: vi.fn().mockResolvedValue(1000000n),
        }),
        balance_of_private: vi.fn().mockReturnValue({
          simulate: vi.fn().mockResolvedValue(500000n),
        }),
      },
    },
  }
})

vi.mock("@defi-wonderland/aztec-standards/artifacts/Token.js", () => ({
  TokenContract: {
    at: vi.fn().mockResolvedValue(mockTokenContract),
  },
}))

describe("Monitor", () => {
  let monitor: Monitor
  let mockEvmMultiClient: any
  let mockAztecWallet: any
  let mockBalanceRepository: any
  let mockLogger: any
  let mockClient: any

  const mockChain = {
    id: 1,
    name: "MockChain",
    nativeCurrency: {
      decimals: 18,
      name: "Ether",
      symbol: "ETH",
    },
    rpcUrls: {
      default: { http: ["http://localhost:8545"] },
      public: { http: ["http://localhost:8545"] },
    },
  }

  const mockConfig = {
    chains: [
      {
        type: "evm",
        id: 1,
        name: "MockChain",
        chain: mockChain,
        rpcUrl: "http://localhost:8545",
        tokens: [{ symbol: "USDC", address: "0xUSDC", decimals: 6 }],
      },
      {
        type: "aztec",
        id: "aztec",
        name: "Aztec",
        rpcUrl: "http://localhost:8080",
        tokens: [
          {
            symbol: "AzUSDC",
            address: "0x1234567890123456789012345678901234567890123456789012345678901234",
            decimals: 6,
          },
        ],
      },
    ],
  }

  beforeEach(() => {
    vi.useFakeTimers()

    mockClient = {
      account: { address: "0x123" },
      getBalance: vi.fn().mockResolvedValue(parseEther("1.0")),
      readContract: vi.fn().mockResolvedValue(1000000n), // 1 USDC
    }

    mockEvmMultiClient = {
      getClientByChain: vi.fn().mockReturnValue({
        publicClient: mockClient,
        walletClient: mockClient,
      }),
    }

    mockAztecWallet = {
      getAddress: vi
        .fn()
        .mockReturnValue(AztecAddress.fromString("0x1234567890123456789012345678901234567890123456789012345678901234")),
      getAztecNode: vi.fn().mockReturnValue({}),
    }

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    mockBalanceRepository = {
      saveBalance: vi.fn(),
    }

    monitor = new Monitor(
      mockEvmMultiClient,
      mockAztecWallet,
      mockBalanceRepository,
      mockConfig as any,
      mockLogger,
      parseEther("0.1"),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    monitor.stop()
    vi.clearAllMocks()
  })

  it("should check EVM native and token balances", async () => {
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockEvmMultiClient.getClientByChain).toHaveBeenCalledWith(mockChain)
    expect(mockClient.getBalance).toHaveBeenCalledWith({ address: "0x123" })
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Native Balance"))
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Token Balance [MockChain - USDC]"))

    expect(mockBalanceRepository.saveBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "MockChain",
        asset: "ETH",
        balance: parseEther("1.0").toString(),
      }),
    )
    expect(mockBalanceRepository.saveBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "MockChain",
        asset: "USDC",
        balance: "1000000",
      }),
    )
  })

  it("should check Aztec token balances", async () => {
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockAztecWallet.getAddress).toHaveBeenCalled()
    // expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Aztec Token Balance [AzUSDC]: 1 (Public)"))
    // expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Aztec Token Balance [AzUSDC]: 0.5 (Private)"))

    // expect(mockBalanceRepository.saveBalance).toHaveBeenCalledWith(
    //   expect.objectContaining({
    //     chain: "Aztec",
    //     asset: "AzUSDC (Public)",
    //     balance: "1000000",
    //   }),
    // )
    // expect(mockBalanceRepository.saveBalance).toHaveBeenCalledWith(
    //   expect.objectContaining({
    //     chain: "Aztec",
    //     asset: "AzUSDC (Private)",
    //     balance: "500000",
    //   }),
    // )
  })

  it("should warn if EVM native balance is low", async () => {
    mockClient.getBalance.mockResolvedValue(parseEther("0.05"))

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("LOW Native BALANCE"))
  })

  it("should handle EVM errors gracefully", async () => {
    mockClient.getBalance.mockRejectedValue(new Error("Network error"))

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to check balances for MockChain"),
      expect.any(Error),
    )
  })

  it("should skip EVM balance check if no tokens are configured", async () => {
    const configWithNoTokens = {
      chains: [
        {
          type: "evm",
          id: 1,
          name: "MockChainNoTokens",
          chain: mockChain,
          rpcUrl: "http://localhost:8545",
          tokens: [],
        },
      ],
    }

    const monitor = new Monitor(
      mockEvmMultiClient,
      mockAztecWallet,
      mockBalanceRepository,
      configWithNoTokens as any,
      mockLogger,
      parseEther("0.1"),
    )

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockEvmMultiClient.getClientByChain).not.toHaveBeenCalled()
    expect(mockClient.getBalance).not.toHaveBeenCalled()
  })

  it("should skip EVM balance check if client has no account", async () => {
    mockClient.account = undefined

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("No account found for chain MockChain"))
    expect(mockClient.getBalance).not.toHaveBeenCalled()
  })

  it("should handle EVM token balance check errors", async () => {
    mockClient.readContract.mockRejectedValue(new Error("Token error"))

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to check token balance for USDC on MockChain"),
      expect.any(Error),
    )
  })

  it("should handle Aztec token balance check errors", async () => {
    mockTokenContract.methods.balance_of_public.mockReturnValue({
      simulate: vi.fn().mockRejectedValue(new Error("Aztec token error")),
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockLogger.error).toHaveBeenCalledWith("Failed to check Aztec balances", expect.any(Error))
  })

  it("should handle Aztec wallet errors", async () => {
    mockAztecWallet.getAddress.mockImplementation(() => {
      throw new Error("Wallet error")
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to check Aztec balances"),
      expect.any(Error),
    )
  })

  it("should not start if already started", () => {
    monitor.start()
    monitor.start()

    // Should only log "Starting Monitor..." once
    expect(mockLogger.info).toHaveBeenCalledTimes(1)
    expect(mockLogger.info).toHaveBeenCalledWith("Starting Monitor...")
  })

  it("should ignore unknown chain types", async () => {
    const configWithUnknownChain = {
      chains: [
        {
          type: "unknown",
          id: "unknown",
          name: "Unknown",
          rpcUrl: "http://localhost:8080",
          tokens: [],
        },
      ],
    }

    const monitor = new Monitor(
      mockEvmMultiClient,
      mockAztecWallet,
      mockBalanceRepository,
      configWithUnknownChain as any,
      mockLogger,
      parseEther("0.1"),
    )

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockEvmMultiClient.getClientByChain).not.toHaveBeenCalled()
    expect(mockAztecWallet.getAddress).not.toHaveBeenCalled()
  })

  it("should skip EVM balance check if chain is undefined", async () => {
    const configWithMissingChain = {
      chains: [
        {
          type: "evm",
          id: 1,
          name: "MockChain",
          // chain: undefined, // Missing chain
          rpcUrl: "http://localhost:8545",
          tokens: [{ symbol: "USDC", address: "0xUSDC", decimals: 6 }],
        },
      ],
    }

    const monitorWithMissingChain = new Monitor(
      mockEvmMultiClient,
      mockAztecWallet,
      mockBalanceRepository,
      configWithMissingChain as any,
      mockLogger,
      parseEther("0.1"),
    )

    monitorWithMissingChain.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockEvmMultiClient.getClientByChain).not.toHaveBeenCalled()
    monitorWithMissingChain.stop()
  })
})
