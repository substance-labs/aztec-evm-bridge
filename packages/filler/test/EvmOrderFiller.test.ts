import { describe, it, expect, vi, beforeEach } from "vitest"
import { fillOrderOnEvm } from "../src/operations/EvmOrderFiller.js"
import { ORDER_STATUS_FILLED } from "../src/constants.js"
import { getChainConfig, isEvmChainConfig } from "../src/config.js"

vi.mock("../src/config.js", () => ({
  getChainConfig: vi.fn().mockReturnValue({
    id: 123,
    name: "L2Chain",
    chain: { id: 123 },
    gateway: "0xGateway",
    type: "evm",
  }),
  isEvmChainConfig: vi.fn().mockReturnValue(true),
  config: {
    evm: { forwarderChainId: "11155111" },
    aztec: { isSandbox: false },
  },
}))

describe("EvmOrderFiller", () => {
  let mockEvmMultiClient: any
  let mockLogger: any
  let mockPublicClient: any
  let mockWalletClient: any

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({}),
    }
    mockWalletClient = {
      writeContract: vi.fn(),
      account: { address: "0xevmFiller" },
    }
    mockEvmMultiClient = {
      getClientByChain: vi.fn().mockReturnValue({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
      }),
    }
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    }
  })

  it("should fill order successfully", async () => {
    const log = {
      orderId: "0x123",
      fillInstructions: [
        {
          originData: "0xdata",
        },
      ],
      maxSpent: [
        {
          amount: 100n,
          token: "0x0000000000000000000000001111111111111111111111111111111111111111",
          recipient: "0xRecipient",
          chainId: 123,
        },
      ],
      minReceived: [
        {
          amount: 50n,
          token: "0xAztecToken",
        },
      ],
    }

    mockPublicClient.readContract.mockResolvedValueOnce(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ) // orderStatus
    mockWalletClient.writeContract.mockResolvedValueOnce("0xApproveTx") // approve
    mockPublicClient.readContract.mockResolvedValueOnce(100n) // allowance
    mockWalletClient.writeContract.mockResolvedValueOnce("0xFillTx") // fill

    const result = await fillOrderOnEvm(
      log as any,
      "L2Chain",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      mockEvmMultiClient,
      mockLogger,
    )

    expect(result).toEqual({
      txHash: "0xFillTx",
      fillerData: "0x0000000000000000000000000000000000000000000000000000000000000000", // padHex(walletClient.account.address) - wait, address is 0xevmFiller
      orderStatus: ORDER_STATUS_FILLED,
    })

    expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(2)
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("filled succesfully"))
  })

  it("should skip if order already processed", async () => {
    const log = {
      orderId: "0x123",
      fillInstructions: [{}],
      minReceived: [{}],
      maxSpent: [{}],
    }
    mockPublicClient.readContract.mockResolvedValueOnce(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    ) // orderStatus != 0

    const result = await fillOrderOnEvm(
      log as any,
      "L2Chain",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      mockEvmMultiClient,
      mockLogger,
    )

    expect(result).toBeNull()
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("already processed"))
  })

  it("should throw error if allowance check fails after retries", async () => {
    vi.useFakeTimers()
    const log = {
      orderId: "0x123",
      fillInstructions: [{ originData: "0xdata" }],
      maxSpent: [
        {
          amount: 100n,
          token: "0x0000000000000000000000001111111111111111111111111111111111111111",
          recipient: "0xRecipient",
          chainId: 123,
        },
      ],
      minReceived: [{ amount: 50n, token: "0xAztecToken" }],
    }

    mockPublicClient.readContract.mockResolvedValueOnce(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ) // orderStatus
    mockWalletClient.writeContract.mockResolvedValueOnce("0xApproveTx") // approve

    // Mock allowance returning 0 repeatedly
    mockPublicClient.readContract.mockResolvedValue(0n)

    const promise = fillOrderOnEvm(
      log as any,
      "L2Chain",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      mockEvmMultiClient,
      mockLogger,
    )

    // Attach handler before triggering rejection
    const expectPromise = expect(promise).rejects.toThrow("Token approval failed")

    // Fast-forward timers to skip delays
    await vi.runAllTimersAsync()

    await expectPromise
    vi.useRealTimers()
  })

  it("should throw error if fill instructions are invalid", async () => {
    const log = {
      orderId: "0x123",
      fillInstructions: [],
      maxSpent: [{}],
      minReceived: [{}],
    }
    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Invalid fill instructions",
    )
  })

  it("should throw error if min received is invalid", async () => {
    const log = {
      orderId: "0x123",
      fillInstructions: [{}],
      maxSpent: [{}],
      minReceived: [],
    }
    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Invalid min received",
    )
  })

  it("should throw error if max spent is invalid", async () => {
    const log = {
      orderId: "0x123",
      fillInstructions: [{}],
      maxSpent: [],
      minReceived: [{}],
    }
    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Invalid max spent",
    )
  })

  it("should throw error if chain config not found", async () => {
    vi.mocked(getChainConfig).mockReturnValueOnce(undefined)
    const log = {
      orderId: "0x123",
      fillInstructions: [{}],
      maxSpent: [{}],
      minReceived: [{}],
    }
    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Chain config not found",
    )
  })

  it("should throw error if chain config type is invalid", async () => {
    vi.mocked(isEvmChainConfig).mockReturnValueOnce(false)
    const log = {
      orderId: "0x123",
      fillInstructions: [{}],
      maxSpent: [{}],
      minReceived: [{}],
    }
    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Invalid chain config type",
    )
  })

  it("should throw error if wallet client account not found", async () => {
    mockWalletClient.account = undefined
    const log = {
      orderId: "0x123",
      fillInstructions: [{}],
      maxSpent: [{}],
      minReceived: [{}],
    }
    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Wallet client account address not found",
    )
  })

  it("should throw error if chain id is invalid", async () => {
    const log = {
      orderId: "0x123",
      fillInstructions: [{ originData: "0xdata" }],
      maxSpent: [
        {
          amount: 100n,
          token: "0x0000000000000000000000001111111111111111111111111111111111111111",
          recipient: "0xRecipient",
          chainId: 999, // Mismatch
        },
      ],
      minReceived: [{ amount: 50n, token: "0xAztecToken" }],
    }

    mockPublicClient.readContract.mockResolvedValueOnce(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ) // orderStatus

    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Invalid chain id",
    )
  })

  it("should handle missing token in maxSpent", async () => {
    const log = {
      orderId: "0x123",
      fillInstructions: [{ originData: "0xdata" }],
      maxSpent: [
        {
          amount: 100n,
          token: "", // Empty token
          recipient: "0xRecipient",
          chainId: 123,
        },
      ],
      minReceived: [{ amount: 50n, token: "0xAztecToken" }],
    }

    mockPublicClient.readContract.mockResolvedValueOnce(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ) // orderStatus

    mockWalletClient.writeContract.mockRejectedValue(new Error("Invalid address"))

    await expect(fillOrderOnEvm(log as any, "L2Chain", "0x0", mockEvmMultiClient, mockLogger)).rejects.toThrow(
      "Invalid address",
    )
  })
})
