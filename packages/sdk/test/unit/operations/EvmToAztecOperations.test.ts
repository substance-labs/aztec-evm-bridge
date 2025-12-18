import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EvmToAztecOperations } from "../../../src/operations/EvmToAztecOperations"
import { BridgeContext } from "../../../src/context/BridgeContext"
import { ChainType, Order, OrderCallbacks } from "../../../src/types"
import { Chain, createPublicClient, http } from "viem"
import { Fr } from "@aztec/aztec.js/fields"

// Mock dependencies
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createPublicClient: vi.fn(),
    http: vi.fn(),
    padHex: vi.fn((val) => val),
  }
})

vi.mock("@aztec/aztec.js/fields", () => ({
  Fr: {
    random: vi.fn(() => ({ toBigInt: () => 12345n })),
    fromString: vi.fn().mockReturnValue("0xFrObject"),
  },
}))

vi.mock("@aztec/foundation/crypto", () => ({
  poseidon2Hash: vi.fn().mockResolvedValue({ toString: () => "0xsecret" }),
  sha256: vi.fn().mockReturnValue(Buffer.from("mockSha256")),
}))

vi.mock("../../../src/utils", () => ({
  OrderDataEncoder: class {
    encode = vi.fn().mockReturnValue("0xencoded")
  },
  hexToUintArray: vi.fn(),
  getResolvedOrderAndOrderIdEvmByReceipt: vi.fn().mockReturnValue({
    orderId: "0xOrderId",
    resolvedOrder: { orderId: "0xOrderId" },
  }),
}))

vi.mock("../../../src/utils/artifacts/AztecGateway7683/AztecGateway7683", () => ({
  AztecGateway7683Contract: {
    at: vi.fn().mockResolvedValue({
      methods: {
        get_order_status: vi.fn().mockReturnValue({
          simulate: vi.fn().mockResolvedValue(2n),
        }),
      },
    }),
  },
}))

describe("EvmToAztecOperations", () => {
  let operations: EvmToAztecOperations
  let mockContext: any
  let mockWalletClient: any
  let mockPublicClient: any

  const mockOrder: Order = {
    amountIn: 100n,
    amountOut: 90n,
    chainIdIn: 1,
    chainIdOut: 2,
    tokenIn: "0xTokenIn",
    tokenOut: "0xTokenOut",
    recipient: "0xRecipient",
    mode: "public",
  }

  beforeEach(() => {
    mockWalletClient = {
      account: { address: "0xSender" },
      writeContract: vi.fn(),
    }

    mockPublicClient = {
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    }
    ;(createPublicClient as any).mockReturnValue(mockPublicClient)

    mockContext = {
      getGatewaysByChainIds: vi.fn().mockReturnValue({
        gatewayIn: "0x0000000000000000000000000000000000000001",
        gatewayOut: "0x0000000000000000000000000000000000000000000000000000000000000002",
      }),
      getChainByChainId: vi.fn().mockReturnValue({ id: 1, name: "MockChain", type: ChainType.EVM, chain: { id: 1 } }),
      getEvmWalletClientAndAddress: vi.fn().mockResolvedValue({ walletClient: mockWalletClient, address: "0xSender" }),
      evmPrivateKey: "0xPrivateKey",
      maybeRegisterAztecGateway: vi.fn(),
      getAztecWallet: vi.fn().mockResolvedValue({}),
      getAztecAccount: vi.fn().mockResolvedValue({
        getAddress: vi.fn().mockReturnValue("0xAztecAccount"),
      }),
    }

    operations = new EvmToAztecOperations(mockContext)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("openOrder", () => {
    it("should open a public order successfully", async () => {
      mockPublicClient.readContract.mockResolvedValue(200n) // Balance
      mockWalletClient.writeContract
        .mockResolvedValueOnce("0xApproveTx") // Approve
        .mockResolvedValueOnce("0xOpenTx") // Open

      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: "success", logs: [] })

      const result = await operations.openOrder(mockOrder)

      expect(mockContext.getGatewaysByChainIds).toHaveBeenCalledWith(1, 2)
      expect(mockContext.getEvmWalletClientAndAddress).toHaveBeenCalled()
      expect(mockPublicClient.readContract).toHaveBeenCalled() // Balance check
      expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(2) // Approve + Open
    })

    it("should throw error if balance is insufficient", async () => {
      mockPublicClient.readContract.mockResolvedValue(50n) // Insufficient Balance

      await expect(operations.openOrder(mockOrder)).rejects.toThrow("Insufficient token balance")
    })
  })
})
