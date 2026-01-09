import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import SettlementService from "../../src/services/settlement.service.js"
import { AztecGateway7683Contract } from "../../src/artifacts/AztecGateway7683/AztecGateway7683.js"
import {
  ORDER_STATUS_FILLED,
  ORDER_STATUS_SETTLE_FORWARDED,
  ORDER_STATUS_SETTLED,
  AZTEC_7683_CHAIN_ID,
  AZTEC_VERSION,
  FORWARDER_CHAIN_ID,
  FORWARDER_ADDRESS,
  SETTLE_ORDER_TYPE,
  AZTEC_ROLLUP_CONTRACT_L1_ADDRESS,
} from "../../src/constants.js"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { waitForTransactionReceipt } from "viem/actions"

let mockIsSandboxEnv = false

// Mock dependencies
vi.mock("../../src/constants.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/constants.js")>()
  return {
    ...actual,
    FORWARDER_ADDRESS: "0x1234567890123456789012345678901234567890",
    AZTEC_ROLLUP_CONTRACT_L1_ADDRESS: "0x1234567890123456789012345678901234567890",
    OP_STACK_ANCHOR_REGISTRY_ADDRESS: "0x1234567890123456789012345678901234567890",
    FORWARDER_CHAIN_ID: 1,
    get IS_SANDBOX_ENV() {
      return mockIsSandboxEnv
    },
  }
})

vi.mock("../../src/artifacts/AztecGateway7683/AztecGateway7683.js")
vi.mock("@aztec/stdlib/messaging", () => ({
  computeL2ToL1MembershipWitness: vi.fn(),
}))
vi.mock("@aztec/stdlib/hash", () => ({
  computeL2ToL1MessageHash: vi.fn(),
}))
vi.mock("viem/actions", () => ({
  waitForTransactionReceipt: vi.fn(),
}))
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem")
  return {
    ...actual,
    keccak256: vi.fn().mockReturnValue("0xhash"),
    encodeAbiParameters: vi.fn().mockReturnValue("0xencoded"),
    bytesToHex: vi.fn().mockReturnValue("0xhex"),
  }
})
vi.mock("@aztec/foundation/crypto/sha256", () => ({
  sha256ToField: vi.fn().mockReturnValue({ toString: () => "0xfield" }),
}))
vi.mock("@lodestar/types", () => ({
  ssz: {
    fulu: {
      BeaconBlock: {
        fromJson: vi.fn(),
        toView: vi.fn(),
      },
    },
  },
}))
vi.mock("@chainsafe/persistent-merkle-tree", () => ({
  createProof: vi.fn(),
  ProofType: { single: "single" },
}))

// Mock fetch
global.fetch = vi.fn()

describe("SettlementService", () => {
  let service: SettlementService
  let mockDb: any
  let mockAztecWallet: any
  let mockEvmMultiClient: any
  let mockLogger: any
  let mockL1PublicClient: any
  let mockL1WalletClient: any
  let mockL2PublicClient: any
  let mockL2WalletClient: any

  let mockCollection: any

  const mockL1Chain = { id: 1, name: "L1" } as any
  const mockL2Chain = { id: 10, name: "L2" } as any

  beforeEach(() => {
    mockCollection = {
      find: vi.fn(),
      toArray: vi.fn().mockResolvedValue([]),
      findOneAndUpdate: vi.fn().mockResolvedValue({}),
    }
    mockCollection.find.mockReturnValue(mockCollection)

    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    }
    mockAztecWallet = {
      getAddress: vi.fn().mockReturnValue(AztecAddress.random()),
      getAztecNode: vi.fn(),
    }

    mockL1PublicClient = {
      readContract: vi.fn(),
      getProof: vi.fn(),
    }
    mockL1WalletClient = {
      writeContract: vi.fn(),
    }
    mockL2PublicClient = {
      getTransactionReceipt: vi.fn(),
      request: vi.fn(),
      getBlock: vi.fn(),
    }
    mockL2WalletClient = {
      writeContract: vi.fn(),
    }

    mockEvmMultiClient = {
      getClientByChain: vi.fn((chain) => {
        if (chain.id === mockL1Chain.id) {
          return { publicClient: mockL1PublicClient, walletClient: mockL1WalletClient }
        } else if (chain.id === mockL2Chain.id) {
          return { publicClient: mockL2PublicClient, walletClient: mockL2WalletClient }
        }
        return null
      }),
    }
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      child: vi.fn().mockReturnThis(),
    }

    service = new SettlementService({
      db: mockDb,
      aztecWallet: mockAztecWallet,
      evmMultiClient: mockEvmMultiClient,
      logger: mockLogger,
      aztecGatewayAddress: "0x0000000000000000000000000000000000000000000000000000000000000001",
      beaconApiUrl: "http://beacon-api",
      forwarderAddress: "0xForwarder",
      l1Chain: mockL1Chain,
      l2EvmChain: mockL2Chain,
      l2EvmGatewayAddress: "0xL2Gateway",
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("constructor", () => {
    it("should start intervals", () => {
      vi.useFakeTimers()

      // Mock prototype methods to verify they are called
      const spyForward = vi
        .spyOn(SettlementService.prototype, "forwardOrderSettlements")
        .mockImplementation(async () => {})
      const spySettle = vi.spyOn(SettlementService.prototype, "settleOrders").mockImplementation(async () => {})

      new SettlementService({
        db: mockDb,
        aztecWallet: mockAztecWallet,
        evmMultiClient: mockEvmMultiClient,
        logger: mockLogger,
        aztecGatewayAddress: "0x0000000000000000000000000000000000000000000000000000000000000001",
        beaconApiUrl: "http://beacon-api",
        forwarderAddress: "0xForwarder",
        l1Chain: mockL1Chain,
        l2EvmChain: mockL2Chain,
        l2EvmGatewayAddress: "0xL2Gateway",
      } as any)

      vi.advanceTimersByTime(30000)
      expect(spyForward).toHaveBeenCalled()
      expect(spySettle).toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe("forwardOrderSettlements", () => {
    it("should forward orders to Aztec if chainId matches L2 EVM", async () => {
      const mockOrder = {
        orderId: "0x123",
        resolvedOrder: { maxSpent: [{ chainId: mockL2Chain.id }] },
        status: ORDER_STATUS_FILLED,
      }
      mockCollection.toArray = vi.fn().mockResolvedValue([mockOrder])
      const spy = vi.spyOn(service, "forwardOrderSettlementToAztec").mockResolvedValue()

      await service.forwardOrderSettlements()

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderId: "0x123" }))
    })

    it("should forward orders to EVM L2 if chainId matches Aztec", async () => {
      const mockOrder = {
        orderId: "0x456",
        resolvedOrder: { maxSpent: [{ chainId: Number(AZTEC_7683_CHAIN_ID) }] },
        status: ORDER_STATUS_FILLED,
      }
      mockCollection.toArray.mockResolvedValue([mockOrder])
      const spy = vi.spyOn(service, "forwardOrderSettlementToEvmL2").mockResolvedValue()

      await service.forwardOrderSettlements()

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderId: "0x456" }))
    })

    it("should ignore orders with unknown chainId", async () => {
      const mockOrder = {
        orderId: "0x789",
        resolvedOrder: { maxSpent: [{ chainId: 12345 }] },
        status: ORDER_STATUS_FILLED,
      }
      mockCollection.toArray.mockResolvedValue([mockOrder])

      const spyAztec = vi.spyOn(service, "forwardOrderSettlementToAztec")
      const spyEvm = vi.spyOn(service, "forwardOrderSettlementToEvmL2")

      await service.forwardOrderSettlements()

      expect(spyAztec).not.toHaveBeenCalled()
      expect(spyEvm).not.toHaveBeenCalled()
    })

    it("should handle errors", async () => {
      mockCollection.toArray.mockRejectedValue(new Error("DB Error"))
      await service.forwardOrderSettlements()
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe("forwardOrderSettlementToAztec", () => {
    const mockOrder = {
      orderId: "0x123",
      resolvedOrder: { fillInstructions: [{ originData: "0xdata" }] },
      fillTxHash: "0xhash",
      fillerData: "0xfiller",
    } as any

    it("should forward settlement to Aztec", async () => {
      mockL1PublicClient.readContract.mockResolvedValue(["0xroot", 100n]) // anchorRootBlockNumber
      mockL2PublicClient.getTransactionReceipt.mockResolvedValue({ blockNumber: 90n })
      mockL2PublicClient.request.mockResolvedValue({
        storageProof: [{ key: "0xkey", value: "0xval", proof: ["0xproof"] }],
        accountProof: ["0xaccountProof"],
      })
      mockL1WalletClient.writeContract.mockResolvedValue("0xforwardTx")

      await service.forwardOrderSettlementToAztec(mockOrder)

      expect(mockL1WalletClient.writeContract).toHaveBeenCalled()
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { orderId: mockOrder.orderId },
        expect.objectContaining({ $set: expect.objectContaining({ status: ORDER_STATUS_SETTLE_FORWARDED }) }),
        expect.any(Object),
      )
    })

    it("should skip if receipt block number > anchor root block number", async () => {
      mockL1PublicClient.readContract.mockResolvedValue(["0xroot", 100n])
      mockL2PublicClient.getTransactionReceipt.mockResolvedValue({ blockNumber: 101n })

      await service.forwardOrderSettlementToAztec(mockOrder)

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("cannot forward settlement"))
      expect(mockL1WalletClient.writeContract).not.toHaveBeenCalled()
    })

    it("should handle errors", async () => {
      mockL1PublicClient.readContract.mockRejectedValue(new Error("RPC Error"))
      await service.forwardOrderSettlementToAztec(mockOrder)
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe("forwardOrderSettlementToEvmL2", () => {
    const mockOrder = {
      orderId: "0x0000000000000000000000000000000000000000000000000000000000000123",
      fillerData: "0x0000000000000000000000000000000000000000000000000000000000000456",
    } as any

    it("should forward settlement to EVM L2", async () => {
      const mockGateway = {
        methods: {
          get_order_settlement_block_number: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(100n),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)
      mockL1PublicClient.readContract.mockResolvedValue(110n) // provenBlockNumber

      const { computeL2ToL1MembershipWitness } = await import("@aztec/stdlib/messaging")
      vi.mocked(computeL2ToL1MembershipWitness).mockResolvedValue({
        root: Fr.random(),
        leafIndex: 1n,
        siblingPath: { toBufferArray: () => [Buffer.from("sibling")] } as any,
      } as any)

      mockL1WalletClient.writeContract.mockResolvedValue("0xforwardTx")

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockL1WalletClient.writeContract).toHaveBeenCalled()
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalled()
    })

    it("should skip if settlement block > proven block", async () => {
      const mockGateway = {
        methods: {
          get_order_settlement_block_number: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(120n),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)
      mockL1PublicClient.readContract.mockResolvedValue(110n)

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("cannot forward settlement"))
      expect(mockL1WalletClient.writeContract).not.toHaveBeenCalled()
    })

    it("should handle errors", async () => {
      vi.mocked(AztecGateway7683Contract.at).mockRejectedValue(new Error("Gateway Error"))

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it("should handle getProvenBlockNumber error", async () => {
      const mockGateway = {
        methods: {
          get_order_settlement_block_number: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(100n),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)
      mockL1PublicClient.readContract.mockRejectedValue(new Error("Contract Error"))

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to get proven block number"))
    })

    it("should throw if witness is missing", async () => {
      const mockGateway = {
        methods: {
          get_order_settlement_block_number: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(100n),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)
      mockL1PublicClient.readContract.mockResolvedValue(110n)

      const { computeL2ToL1MembershipWitness } = await import("@aztec/stdlib/messaging")
      vi.mocked(computeL2ToL1MembershipWitness).mockResolvedValue(undefined)

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("Failed to compute L2ToL1 membership witness") }),
      )
    })

    it("should skip if IS_SANDBOX_ENV is true and getProvenBlockNumber fails", async () => {
      mockIsSandboxEnv = true
      const mockGateway = {
        methods: {
          get_order_settlement_block_number: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(100n),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)
      mockL1PublicClient.readContract.mockRejectedValue(new Error("Contract Error"))

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("skipping forwardSettleToL2"))
      mockIsSandboxEnv = false
    })

    it("should handle non-Error exception when IS_SANDBOX_ENV is true", async () => {
      mockIsSandboxEnv = true
      const mockGateway = {
        methods: {
          get_order_settlement_block_number: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(100n),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)
      mockL1PublicClient.readContract.mockRejectedValue("String Error")

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("String Error"))
      mockIsSandboxEnv = false
    })

    it("should handle non-Error exception when IS_SANDBOX_ENV is false", async () => {
      const mockGateway = {
        methods: {
          get_order_settlement_block_number: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(100n),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)
      mockL1PublicClient.readContract.mockRejectedValue("String Error")

      await service.forwardOrderSettlementToEvmL2(mockOrder)

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("String Error"))
    })
  })

  describe("settleOrders", () => {
    it("should settle orders on Aztec", async () => {
      const mockOrder = {
        orderId: "0x123",
        resolvedOrder: { maxSpent: [{ chainId: mockL2Chain.id }] },
        status: ORDER_STATUS_SETTLE_FORWARDED,
      }
      mockCollection.toArray.mockResolvedValue([mockOrder])
      const spy = vi.spyOn(service, "settleOrderOnAztec").mockResolvedValue()

      await service.settleOrders()

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderId: "0x123" }))
    })

    it("should settle orders on EVM L2", async () => {
      const mockOrder = {
        orderId: "0x456",
        resolvedOrder: { maxSpent: [{ chainId: Number(AZTEC_7683_CHAIN_ID) }] },
        status: ORDER_STATUS_SETTLE_FORWARDED,
      }
      mockCollection.toArray.mockResolvedValue([mockOrder])
      const spy = vi.spyOn(service, "settleOrderOnEvmL2").mockResolvedValue()

      await service.settleOrders()

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderId: "0x456" }))
    })

    it("should handle errors during individual order settlement", async () => {
      const mockOrder = {
        orderId: "0x123",
        resolvedOrder: { maxSpent: [{ chainId: mockL2Chain.id }] },
        status: ORDER_STATUS_SETTLE_FORWARDED,
      }
      mockCollection.toArray.mockResolvedValue([mockOrder])
      vi.spyOn(service, "settleOrderOnAztec").mockRejectedValue(new Error("Settlement Error"))

      await service.settleOrders()

      // Should not throw
      expect(service.settleOrderOnAztec).toHaveBeenCalled()
    })

    it("should handle errors during EVM L2 order settlement", async () => {
      const mockOrder = {
        orderId: "0x456",
        resolvedOrder: { maxSpent: [{ chainId: Number(AZTEC_7683_CHAIN_ID) }] },
        status: ORDER_STATUS_SETTLE_FORWARDED,
      }
      mockCollection.toArray.mockResolvedValue([mockOrder])
      vi.spyOn(service, "settleOrderOnEvmL2").mockRejectedValue(new Error("Settlement Error"))

      await service.settleOrders()

      expect(service.settleOrderOnEvmL2).toHaveBeenCalled()
    })

    it("should ignore orders with unknown chainId", async () => {
      const mockOrder = {
        orderId: "0x789",
        resolvedOrder: { maxSpent: [{ chainId: 12345 }] },
        status: ORDER_STATUS_SETTLE_FORWARDED,
      }
      mockCollection.toArray.mockResolvedValue([mockOrder])

      const spyAztec = vi.spyOn(service, "settleOrderOnAztec")
      const spyEvm = vi.spyOn(service, "settleOrderOnEvmL2")

      await service.settleOrders()

      expect(spyAztec).not.toHaveBeenCalled()
      expect(spyEvm).not.toHaveBeenCalled()
    })

    it("should handle db error in settleOrders", async () => {
      mockCollection.toArray.mockRejectedValue(new Error("DB Error"))

      await service.settleOrders()

      expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({ message: "DB Error" }))
    })
  })

  describe("settleOrderOnAztec", () => {
    it("should log info", async () => {
      const mockOrder = { orderId: "0x123" } as any
      await service.settleOrderOnAztec(mockOrder)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("settling order"))
    })

    it("should handle errors", async () => {
      const error = new Error("Logger Error")
      mockLogger.info.mockImplementation(() => {
        throw error
      })

      await service.settleOrderOnAztec({ orderId: "0x123" } as any)

      expect(mockLogger.error).toHaveBeenCalledWith(error)
    })
  })

  describe("settleOrderOnEvmL2", () => {
    const mockOrder = {
      orderId: "0x0000000000000000000000000000000000000000000000000000000000000123",
      fillerData: "0x0000000000000000000000000000000000000000000000000000000000000456",
    } as any

    it("should settle order on EVM L2", async () => {
      mockL2PublicClient.getBlock.mockResolvedValue({
        parentBeaconBlockRoot: "0xbeaconRoot",
        timestamp: 1234567890n,
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: {
            message: {
              slot: 100,
              body: { execution_payload: { block_number: "1000" } },
            },
          },
        }),
      } as any)

      const { ssz } = await import("@lodestar/types")
      vi.mocked(ssz.fulu.BeaconBlock.fromJson).mockReturnValue({} as any)
      vi.mocked(ssz.fulu.BeaconBlock.toView).mockReturnValue({
        type: { getPathInfo: vi.fn().mockReturnValue({ gindex: 1 }) },
        node: {},
      } as any)

      const { createProof } = await import("@chainsafe/persistent-merkle-tree")
      vi.mocked(createProof).mockReturnValue({
        witnesses: [new Uint8Array([1, 2, 3])],
        leaf: new Uint8Array([4, 5, 6]),
      } as any)

      mockL1PublicClient.getProof.mockResolvedValue({
        storageProof: [{ key: "0xkey", value: 1n, proof: ["0xproof"] }],
        accountProof: ["0xaccountProof"],
      })

      mockL2WalletClient.writeContract.mockResolvedValue("0xsettleTx")

      await service.settleOrderOnEvmL2(mockOrder)

      expect(mockL2WalletClient.writeContract).toHaveBeenCalled()
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { orderId: mockOrder.orderId },
        expect.objectContaining({ $set: expect.objectContaining({ status: ORDER_STATUS_SETTLED }) }),
        expect.any(Object),
      )
    })

    it("should retry if storage value is not 1", async () => {
      mockL2PublicClient.getBlock.mockResolvedValue({
        parentBeaconBlockRoot: "0xbeaconRoot",
        timestamp: 1234567890n,
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: {
            message: {
              slot: 100,
              body: { execution_payload: { block_number: "1000" } },
            },
          },
        }),
      } as any)

      // Mock SSZ and Proof generation (same as above)
      const { ssz } = await import("@lodestar/types")
      vi.mocked(ssz.fulu.BeaconBlock.fromJson).mockReturnValue({} as any)
      vi.mocked(ssz.fulu.BeaconBlock.toView).mockReturnValue({
        type: { getPathInfo: vi.fn().mockReturnValue({ gindex: 1 }) },
        node: {},
      } as any)
      const { createProof } = await import("@chainsafe/persistent-merkle-tree")
      vi.mocked(createProof).mockReturnValue({
        witnesses: [],
        leaf: new Uint8Array(),
      } as any)

      mockL1PublicClient.getProof.mockResolvedValue({
        storageProof: [{ key: "0xkey", value: 0n, proof: ["0xproof"] }], // Value 0 means not settled yet
        accountProof: ["0xaccountProof"],
      })

      await service.settleOrderOnEvmL2(mockOrder)

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("storage value not up to date yet"))
      expect(mockL2WalletClient.writeContract).not.toHaveBeenCalled()
    })

    it("should handle errors", async () => {
      mockL2PublicClient.getBlock.mockRejectedValue(new Error("RPC Error"))
      await service.settleOrderOnEvmL2(mockOrder)
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it("should handle fetch errors", async () => {
      mockL2PublicClient.getBlock.mockResolvedValue({ parentBeaconBlockRoot: "0xbeaconRoot", timestamp: 1234567890n })
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      } as any)

      await service.settleOrderOnEvmL2(mockOrder)

      expect(mockLogger.error).toHaveBeenCalled()
    })
  })
})
