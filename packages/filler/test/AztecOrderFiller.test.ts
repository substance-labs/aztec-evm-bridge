import { describe, it, expect, vi, beforeEach } from "vitest"
import { fillOrderOnAztec } from "../src/operations/AztecOrderFiller.js"
import { ORDER_STATUS_FILLED, ORDER_STATUS_FILLED_PRIVATELY, AZTEC_7683_CHAIN_ID } from "../src/constants.js"
import { isTokenSupported, getChainConfig } from "../src/config.js"

// Mock dependencies
vi.mock("../src/utils/aztec.js", () => ({
  getPaymentMethod: vi.fn().mockResolvedValue({}),
  registerContractWithoutInstance: vi.fn().mockResolvedValue({}),
}))

vi.mock("@defi-wonderland/aztec-standards/artifacts/Token.js", () => ({
  TokenContract: {
    at: vi.fn().mockResolvedValue({
      methods: {
        transfer_public_to_public: vi.fn().mockReturnValue({}),
        transfer_private_to_public: vi.fn().mockReturnValue({}),
      },
    }),
  },
  TokenContractArtifact: {},
}))

vi.mock("../src/artifacts/AztecGateway7683/AztecGateway7683.js", () => ({
  AztecGateway7683Contract: {
    at: vi.fn().mockResolvedValue({
      methods: {
        fill: vi.fn().mockReturnValue({
          send: vi.fn().mockReturnValue({
            wait: vi.fn().mockResolvedValue({ txHash: "0xAztecTx" }),
          }),
        }),
        fill_private: vi.fn().mockReturnValue({
          with: vi.fn().mockReturnValue({
            send: vi.fn().mockReturnValue({
              wait: vi.fn().mockResolvedValue({ txHash: "0xAztecTxPrivate" }),
            }),
          }),
        }),
      },
    }),
  },
}))

vi.mock("../src/config.js", () => ({
  getChainConfig: vi.fn().mockReturnValue({
    gateway: "0x0000000000000000000000000000000000000000000000000000000000000001",
  }),
  isTokenSupported: vi.fn().mockReturnValue(true),
}))

describe("AztecOrderFiller", () => {
  let mockAztecWallet: any
  let mockEvmMultiClient: any
  let mockLogger: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockAztecWallet = {
      getAddress: vi.fn().mockReturnValue({ toString: () => "0xAztecFiller" }),
      setPublicAuthWit: vi.fn().mockResolvedValue({
        send: vi.fn().mockReturnValue({
          wait: vi.fn().mockResolvedValue({}),
        }),
      }),
      createAuthWit: vi.fn().mockResolvedValue({}),
    }
    mockEvmMultiClient = {
      getWalletClientByChain: vi.fn().mockReturnValue({
        account: { address: "0x1111111111111111111111111111111111111111" },
      }),
    }
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    }
  })

  const createLog = (orderTypeHex = "00", chainId = AZTEC_7683_CHAIN_ID) => ({
    args: {
      orderId: "0x123",
      resolvedOrder: {
        fillInstructions: [
          {
            originData:
              "0x" +
              "00".repeat(32) + // sender
              "00".repeat(32) + // recipient (offset 66)
              "00".repeat(32) + // inputToken
              "00".repeat(32) + // outputToken
              "00".repeat(32) + // amountIn
              "00".repeat(32) + // amountOut
              "00".repeat(32) + // senderNonce (offset 386)
              "00".repeat(4) + // originDomain
              "00".repeat(4) + // destinationDomain
              "00".repeat(32) + // destinationSettler
              "00".repeat(4) + // fillDeadline
              orderTypeHex + // orderType (offset 538)
              "00".repeat(32), // data
          },
        ],
        maxSpent: [
          {
            amount: 100n,
            token: "0x0000000000000000000000001111111111111111111111111111111111111111",
            recipient: "0xRecipient",
            chainId: chainId,
          },
        ],
        minReceived: [
          {
            amount: 50n,
            token: "0xAztecToken",
          },
        ],
      },
    },
  })

  it("should fill public order successfully", async () => {
    const log = createLog("00")

    const result = await fillOrderOnAztec(log as any, mockAztecWallet, mockEvmMultiClient, mockLogger)

    expect(result).toEqual({
      txHash: "0xAztecTx",
      fillerData: "0x0000000000000000000000001111111111111111111111111111111111111111", // padHex result
      orderStatus: ORDER_STATUS_FILLED,
      logArgs: log.args,
    })
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Swapping from X to Aztec"))
  })

  it("should fill private order successfully", async () => {
    const log = createLog("01")

    const result = await fillOrderOnAztec(log as any, mockAztecWallet, mockEvmMultiClient, mockLogger)

    expect(result).toEqual({
      txHash: "0xAztecTxPrivate",
      fillerData: "0x0000000000000000000000001111111111111111111111111111111111111111",
      orderStatus: ORDER_STATUS_FILLED_PRIVATELY,
      logArgs: log.args,
    })
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Filling the private order"))
  })

  it("should throw error if token is not supported", async () => {
    vi.mocked(isTokenSupported).mockReturnValueOnce(false)
    const log = createLog("00")

    await expect(fillOrderOnAztec(log as any, mockAztecWallet, mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Token 0x0000000000000000000000001111111111111111111111111111111111111111 is not supported",
    )
  })

  it("should throw error if chain id is invalid", async () => {
    const log = createLog("00", 12345n)

    await expect(fillOrderOnAztec(log as any, mockAztecWallet, mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Invalid chain id",
    )
  })

  it("should return null for unknown order status", async () => {
    const log = createLog("02") // Unknown order type

    const result = await fillOrderOnAztec(log as any, mockAztecWallet, mockEvmMultiClient, mockLogger)

    expect(result).toBeNull()
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Unknown order status"))
  })

  it("should throw error if chain config not found", async () => {
    vi.mocked(getChainConfig).mockReturnValueOnce(undefined)
    const log = createLog("00")

    await expect(fillOrderOnAztec(log as any, mockAztecWallet, mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Chain config not found",
    )
  })

  it("should throw error if no EVM filler address found", async () => {
    mockEvmMultiClient.getWalletClientByChain.mockReturnValue({ account: undefined })
    const log = createLog("00")

    await expect(fillOrderOnAztec(log as any, mockAztecWallet, mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "No EVM filler address found",
    )
  })
})
