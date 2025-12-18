import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { AztecToEvmOperations } from "../../../src/operations/AztecToEvmOperations"
import { BridgeContext } from "../../../src/context/BridgeContext"
import { ChainType, Order } from "../../../src/types"
import { Fr } from "@aztec/aztec.js/fields"

// Mock dependencies
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      readContract: vi.fn().mockResolvedValue("0x0000000000000000000000000000000000000000000000000000000000000003"),
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getLogs: vi.fn().mockResolvedValue([{ transactionHash: "0xEvmTxHash" }]),
    }),
    http: vi.fn(),
  }
})

vi.mock("@aztec/aztec.js/fields", () => ({
  Fr: {
    random: vi.fn(() => ({ toBigInt: () => 12345n })),
  },
}))

vi.mock("../../../src/utils", () => ({
  OrderDataEncoder: class {
    encode = vi.fn().mockReturnValue("0xencoded")
  },
  hexToUintArray: vi.fn(),
  getAztecAddressFromAzguardAccount: vi.fn().mockReturnValue("0xAztecAddress"),
  getResolvedOrderByAztecLogs: vi
    .fn()
    .mockReturnValue([{ orderId: "0x0000000000000000000000000000000000000000000000000000000000000003" }]),
}))

vi.mock("@aztec/aztec.js/node", () => ({
  createAztecNodeClient: vi.fn().mockReturnValue({
    getTxReceipt: vi.fn().mockResolvedValue({
      status: "success",
      blockNumber: 100,
      txHash: { toString: () => "0xTxHash" },
    }),
    getPublicLogs: vi.fn().mockResolvedValue({ logs: [] }),
  }),
}))

vi.mock("@aztec/aztec.js/tx", () => ({
  TxHash: {
    fromString: vi.fn().mockReturnValue("0xTxHashObject"),
  },
}))

describe("AztecToEvmOperations", () => {
  let operations: AztecToEvmOperations
  let mockContext: any
  let mockAzguardClient: any

  const mockOrder: Order = {
    amountIn: 100n,
    amountOut: 90n,
    chainIdIn: 999999,
    chainIdOut: 1,
    tokenIn: "0xTokenIn",
    tokenOut: "0xTokenOut",
    recipient: "0xRecipient",
    mode: "public",
  }

  beforeEach(() => {
    mockAzguardClient = {
      accounts: [{ address: "0xAzguardAccount" }],
      execute: vi.fn(),
    }

    mockContext = {
      getGatewaysByChainIds: vi.fn().mockReturnValue({
        gatewayIn: "0x0000000000000000000000000000000000000000000000000000000000000001",
        gatewayOut: "0x0000000000000000000000000000000000000002",
      }),
      getChainInAndOutByChainIds: vi.fn().mockReturnValue({
        chainIn: {
          type: ChainType.AZTEC,
          chain: {
            id: 999999,
            rpcUrls: {
              default: { http: ["http://localhost:8080"] },
            },
          },
        },
        chainOut: {
          type: ChainType.EVM,
          chain: {
            id: 1,
            name: "Mock Chain",
            rpcUrls: {
              default: { http: ["http://localhost:8545"] },
            },
          },
        },
      }),
      maybeRegisterAztecGateway: vi.fn(),
      azguardClient: mockAzguardClient,
    }

    operations = new AztecToEvmOperations(mockContext)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("openOrder", () => {
    it("should open a public order successfully via Azguard", async () => {
      mockAzguardClient.execute.mockResolvedValue([
        { status: "success", result: "contract_registered" },
        { status: "success", result: "0xTxHash" },
      ])

      await operations.openOrder(mockOrder)

      expect(mockContext.getGatewaysByChainIds).toHaveBeenCalledWith(999999, 1)
      expect(mockContext.maybeRegisterAztecGateway).toHaveBeenCalled()
      expect(mockAzguardClient.execute).toHaveBeenCalled()
    })
  })
})
