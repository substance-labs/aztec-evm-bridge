import { baseSepolia, sepolia } from "viem/chains"
import { Chain, Hex, padHex } from "viem"

import { ChainType, type InternalChain } from "../types"

export const ORDER_DATA_TYPE = "0xf00c3bf60c73eb97097f1c9835537da014e0b755fe94b25d7ac8401df66716a0"
export const REFUND_ORDER_TYPE = "0x66ad36d8ca106da96563556152aba4b916ec696ecdd08a3e5ed368f4e473a538"
export const SETTLE_ORDER_TYPE = "0x191ea776bd6e0cd56a6d44ba4aea2fec468b4a0b4c1d880d4025929eeb615d0d"
export const PUBLIC_ORDER = 0
export const PRIVATE_ORDER = 1
export const PUBLIC_ORDER_WITH_HOOK = 2
export const PRIVATE_ORDER_WITH_HOOK = 3
export const PRIVATE_SENDER = padHex("0x")
export const OPENED = 1
export const FILLED = 2
export const FILLED_PRIVATELY = 3
export const AZTEC_VERSION = 1647720761
export const FORWARDER_SETTLE_ORDER_SLOT = 2n
export const FORWARDER_REFUNDED_ORDERS_SLOT = 3n
export const L2_GATEWAY_FILLED_ORDERS_SLOT = 51n
export const L2_GATEWAY_REFUNDED_ORDERS_SLOT = 52n

export const DEFAULT_AZTEC_ROLLUP_L1_ADDRESS: Hex = "0xb05f36c9dffa76f0af639385ef44d5560e0160c1"
export const DEFAULT_FORWARDER_ADDRESS: Hex = "0xE386eac74859de4A2e61F76Ca915007e3f8203c4" // Updated from deploy_2026-01-18_21-39-54.json
export const DEFAULT_OP_STACK_ANCHOR_REGISTRY: Hex = "0x0729957c92A1F50590A84cb2D65D761093f3f8eB"

export const aztecRollupContractL1Addresses: Record<number, Hex> = {
  [sepolia.id]: DEFAULT_AZTEC_ROLLUP_L1_ADDRESS,
}

export const forwarderAddresses: Record<number, Hex> = {
  [sepolia.id]: DEFAULT_FORWARDER_ADDRESS,
}

export const opStackAnchorRegistryAddresses: Record<number, Hex> = {
  [sepolia.id]: DEFAULT_OP_STACK_ANCHOR_REGISTRY,
}

export const FORWARDER_CHAIN: Chain = baseSepolia
export const DEFAULT_FORWARDER_CHAIN_ID = sepolia.id

export const aztecSepolia = {
  id: 999999,
  name: "Aztec Sepolia",
  rpcUrls: {
    "aztec-devnet": {
      http: [process.env.AZTEC_RPC_URL || "https://devnet-6.aztec-labs.com"],
    },
    default: {
      http: [process.env.AZTEC_RPC_URL || "https://devnet-6.aztec-labs.com"],
    },
  },
}

export const defaultChainsConfig: Record<string, InternalChain> = {
  baseSepolia: {
    type: ChainType.EVM,
    chain: baseSepolia,
    gatewayAddress: "0x79917002AD4734d8b06fA8945460fbce72099F2E", // Updated from deploy_2026-01-18_21-39-54.json
  },
  aztecDevnet: {
    type: ChainType.AZTEC,
    chain: aztecSepolia,
    gatewayAddress: "0x0b207e862ba72308acd9a7e714767e2083bb5619fed01608bb9fb011aa3655d9", // Updated from deploy_2026-01-18_21-39-54.json
  },
}

/** @deprecated Use BridgeConfigs.chainsConfig instead for custom configuration */
export const chainsConfig: Record<string, InternalChain> = defaultChainsConfig
