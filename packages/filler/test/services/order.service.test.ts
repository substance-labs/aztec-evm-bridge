import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import OrderService from "../../src/services/order.service.js"
import { OrderRepository } from "../../src/repositories/OrderRepository.js"
import { AztecGateway7683Contract } from "../../src/artifacts/AztecGateway7683/AztecGateway7683.js"
import { fillOrderOnEvm } from "../../src/operations/EvmOrderFiller.js"
import { fillOrderOnAztec } from "../../src/operations/AztecOrderFiller.js"
import { getChainConfig, ChainConfigType } from "../../src/config.js"
import { ORDER_FILLED, ORDER_STATUS_FILLED, ORDER_STATUS_FILLED_PRIVATELY } from "../../src/constants.js"
import { Fr } from "@aztec/aztec.js/fields"
import { AztecAddress } from "@aztec/aztec.js/addresses"

// Mock dependencies
vi.mock("../../src/repositories/OrderRepository.js")
vi.mock("../../src/artifacts/AztecGateway7683/AztecGateway7683.js")
vi.mock("../../src/operations/EvmOrderFiller.js")
vi.mock("../../src/operations/AztecOrderFiller.js")
vi.mock("../../src/config.js", async () => {
  const actual = await vi.importActual("../../src/config.js")
  return {
    ...actual,
    getChainConfig: vi.fn(),
    config: {
      chains: {
        aztec: {
          gateway: "0x1111111111111111111111111111111111111111111111111111111111111111",
        },
      },
    },
  }
})

describe("OrderService", () => {
  let service: OrderService
  let mockDb: any
  let mockAztecWallet: any
  let mockEvmMultiClient: any
  let mockLogger: any

  beforeEach(() => {
    mockDb = {}
    mockAztecWallet = {
      getAddress: vi.fn().mockReturnValue(AztecAddress.random()),
    }
    mockEvmMultiClient = {}
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      child: vi.fn().mockReturnThis(),
    }

    // Mock OrderRepository instance
    vi.mocked(OrderRepository).mockImplementation(function () {
      return {
        findByStatus: vi.fn(),
        updateStatus: vi.fn(),
        findByOrderId: vi.fn(),
        addOrder: vi.fn(),
      } as any
    })

    service = new OrderService({
      db: mockDb,
      aztecWallet: mockAztecWallet,
      evmMultiClient: mockEvmMultiClient,
      logger: mockLogger,
    } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("constructor", () => {
    it("should start monitoring interval", () => {
      vi.useFakeTimers()

      // Re-instantiate service to set up interval
      service = new OrderService({
        db: mockDb,
        aztecWallet: mockAztecWallet,
        evmMultiClient: mockEvmMultiClient,
        logger: mockLogger,
      } as any)

      // Spy on monitorFilledPrivatelyOrders
      const spy = vi.spyOn(service, "monitorFilledPrivatelyOrders")

      // Fast forward time
      vi.advanceTimersByTime(180000)

      expect(spy).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe("monitorFilledPrivatelyOrders", () => {
    it("should do nothing if no privately filled orders found", async () => {
      vi.mocked(service.orderRepository.findByStatus).mockResolvedValue([])

      await service.monitorFilledPrivatelyOrders()

      expect(service.orderRepository.findByStatus).toHaveBeenCalledWith(ORDER_STATUS_FILLED_PRIVATELY)
      expect(mockLogger.info).toHaveBeenCalledWith("no orders initiated privately found ...")
    })

    it("should update status if orders are filled", async () => {
      const orderId = "0x0000000000000000000000000000000000000000000000000000000000000123"
      const mockOrders = [{ orderId }]
      vi.mocked(service.orderRepository.findByStatus).mockResolvedValue(mockOrders as any)

      const mockGateway = {
        methods: {
          get_order_status: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(ORDER_FILLED),
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)

      await service.monitorFilledPrivatelyOrders()

      expect(service.orderRepository.updateStatus).toHaveBeenCalledWith([orderId], ORDER_STATUS_FILLED)
    })

    it("should not update status if orders are not filled", async () => {
      const orderId = "0x0000000000000000000000000000000000000000000000000000000000000123"
      const mockOrders = [{ orderId }]
      vi.mocked(service.orderRepository.findByStatus).mockResolvedValue(mockOrders as any)

      const mockGateway = {
        methods: {
          get_order_status: vi.fn().mockReturnValue({
            simulate: vi.fn().mockResolvedValue(0n), // Not filled
          }),
        },
      }
      vi.mocked(AztecGateway7683Contract.at).mockResolvedValue(mockGateway as any)

      await service.monitorFilledPrivatelyOrders()

      expect(service.orderRepository.updateStatus).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith("no orders filled privately found ...")
    })

    it("should handle errors", async () => {
      vi.mocked(service.orderRepository.findByStatus).mockRejectedValue(new Error("DB Error"))

      await service.monitorFilledPrivatelyOrders()

      expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe("fillOrderFromAztecLog", () => {
    const mockLog = { orderId: "0x123" } as any

    it("should skip if order already exists", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue({} as any)

      await service.fillOrderFromAztecLog(mockLog, "eth")

      expect(mockLogger.info).toHaveBeenCalledWith(`Order ${mockLog.orderId} already stored in the db. skipping it ...`)
      expect(fillOrderOnEvm).not.toHaveBeenCalled()
    })

    it("should skip if destination is Aztec (Aztec to Aztec not supported)", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: ChainConfigType.AZTEC } as any)

      await service.fillOrderFromAztecLog(mockLog, "aztec")

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Aztec to Aztec orders are not supported. Skipping order ${mockLog.orderId} ...`,
      )
    })

    it("should fill order on EVM if destination is EVM", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: ChainConfigType.EVM } as any)
      vi.mocked(fillOrderOnEvm).mockResolvedValue({
        fillerData: "0xdata",
        txHash: "0xhash",
        orderStatus: "FILLED",
      } as any)

      await service.fillOrderFromAztecLog(mockLog, "eth")

      expect(fillOrderOnEvm).toHaveBeenCalled()
      expect(service.orderRepository.addOrder).toHaveBeenCalled()
    })

    it("should not add order if fillOrderOnEvm returns undefined", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: ChainConfigType.EVM } as any)
      vi.mocked(fillOrderOnEvm).mockResolvedValue(undefined)

      await service.fillOrderFromAztecLog(mockLog, "eth")

      expect(fillOrderOnEvm).toHaveBeenCalled()
      expect(service.orderRepository.addOrder).not.toHaveBeenCalled()
    })

    it("should log error for unknown chain type", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: "unknown" } as any)

      await service.fillOrderFromAztecLog(mockLog, "unknown")

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Unknown destination chain type for order ${mockLog.orderId}. Skipping it ...`,
      )
    })

    it("should handle errors", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockRejectedValue(new Error("DB Error"))

      await service.fillOrderFromAztecLog(mockLog, "eth")

      expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe("fillOrderFromEvmLog", () => {
    const mockLog = { args: { orderId: "0x123" } } as any

    it("should skip if order already exists", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue({} as any)

      await service.fillOrderFromEvmLog(mockLog, "aztec")

      expect(mockLogger.info).toHaveBeenCalledWith(`order ${mockLog.args.orderId} already processed. skipping it ...`)
      expect(fillOrderOnAztec).not.toHaveBeenCalled()
    })

    it("should fill order on Aztec if destination is Aztec", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: "aztec" } as any)
      vi.mocked(fillOrderOnAztec).mockResolvedValue({
        fillerData: "0xdata",
        txHash: "0xhash",
        orderStatus: "FILLED",
        logArgs: {},
      } as any)

      await service.fillOrderFromEvmLog(mockLog, "aztec")

      expect(fillOrderOnAztec).toHaveBeenCalled()
      expect(service.orderRepository.addOrder).toHaveBeenCalled()
    })

    it("should not add order if fillOrderOnAztec returns undefined", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: "aztec" } as any)
      vi.mocked(fillOrderOnAztec).mockResolvedValue(undefined)

      await service.fillOrderFromEvmLog(mockLog, "aztec")

      expect(fillOrderOnAztec).toHaveBeenCalled()
      expect(service.orderRepository.addOrder).not.toHaveBeenCalled()
    })

    it("should skip if destination is EVM (EVM to EVM not supported)", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: "evm" } as any)

      await service.fillOrderFromEvmLog(mockLog, "eth")

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Evm to Evm orders are not supported. Skipping order ${mockLog.args.orderId} ...`,
      )
    })

    it("should log error for unknown chain type", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockResolvedValue(null)
      vi.mocked(getChainConfig).mockReturnValue({ type: "unknown" } as any)

      await service.fillOrderFromEvmLog(mockLog, "unknown")

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Unknown destination chain type for order ${mockLog.args.orderId}. Skipping it ...`,
      )
    })

    it("should handle errors", async () => {
      vi.mocked(service.orderRepository.findByOrderId).mockRejectedValue(new Error("DB Error"))

      await service.fillOrderFromEvmLog(mockLog, "aztec")

      expect(mockLogger.error).toHaveBeenCalledWith("Error occurred while filling order:")
      expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})
