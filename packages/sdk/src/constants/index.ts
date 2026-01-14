import { base, baseSepolia, sepolia } from "viem/chains"
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

export const aztecRollupContractL1Addresses: Record<number, Hex> = {
  [sepolia.id]: "0xb05f36c9dffa76f0af639385ef44d5560e0160c1",
}

export const forwarderAddresses: Record<number, Hex> = {
  [sepolia.id]: "0xF192Cc7A689f7FFB0cd0016a818AC291AbEAd8Cb",
}

export const opStackAnchorRegistryAddresses: Record<number, Hex> = {
  [sepolia.id]: "0x0729957c92A1F50590A84cb2D65D761093f3f8eB",
}

export const FORWARDER_CHAIN: Chain = baseSepolia

export const aztecSepolia = {
  id: 999999,
  name: "Aztec Sepolia",
  rpcUrls: {
    "aztec-devnet": {
      http: ["https://next.devnet.aztec-labs.com"],
    },
    default: {
      http: ["https://next.devnet.aztec-labs.com"],
    },
  },
}

export const chainsConfig: Record<string, InternalChain> = {
  baseSepolia: {
    type: ChainType.EVM,
    chain: baseSepolia,
    gatewayAddress: "0xd2Fc7cBb86b4f5976D8b0c42Aa9cBEf0bcf16005",
  },
  aztecDevnet: {
    type: ChainType.AZTEC,
    chain: aztecSepolia,
    gatewayAddress: "0x0e4076b4b8a7bd025450499799f2ab42fc48c05a9407f00495aa8948ad80b4da",
  },
}
