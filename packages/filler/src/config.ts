import { baseSepolia } from "viem/chains"
import type { Chain } from "viem"

export enum ChainConfigType {
  EVM = "evm",
  AZTEC = "aztec",
}

export interface TokenConfig {
  name: string
  symbol: string
  decimals: number
  address: string
}

export interface BaseChainConfig {
  id: number | string
  name: string
  rpcUrl: string
  tokens: TokenConfig[]
}

export interface EvmChainConfig extends BaseChainConfig {
  type: ChainConfigType.EVM
  chain: Chain
  gateway: `0x${string}`
}

export interface AztecChainConfig extends BaseChainConfig {
  type: ChainConfigType.AZTEC
  gateway: `0x${string}`
}

export type ChainConfig = EvmChainConfig | AztecChainConfig

export interface FillerConfig {
  chains: { aztec: AztecChainConfig } & Record<string, ChainConfig>
  balanceCheckIntervalMs: number
}

export const config: FillerConfig = {
  chains: {
    baseSepolia: {
      type: ChainConfigType.EVM,
      id: baseSepolia.id,
      name: baseSepolia.name,
      rpcUrl: process.env.EVM_L2_RPC_URL || baseSepolia.rpcUrls.default.http[0],
      chain: baseSepolia,
      gateway: (process.env.L2_EVM_GATEWAY_ADDRESS || "0xd2Fc7cBb86b4f5976D8b0c42Aa9cBEf0bcf16005") as `0x${string}`,
      tokens: [
        {
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          address: process.env.L2_EVM_TOKEN_ADDRESS || "0xF2D41ea5bD5b3A686a2aDB387EbF83913BDAA055",
        },
      ],
    },
    aztec: {
      type: ChainConfigType.AZTEC,
      id: "999999",
      name: "Aztec",
      rpcUrl: process.env.AZTEC_RPC_URL || "https://next.devnet.aztec-labs.com",
      gateway: (process.env.AZTEC_GATEWAY_ADDRESS ||
        "0x0e4076b4b8a7bd025450499799f2ab42fc48c05a9407f00495aa8948ad80b4da") as `0x${string}`,
      tokens: [
        {
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          address:
            process.env.AZTEC_TOKEN_ADDRESS || "0x0e334ca55bc06810c70f9cba8a341d79f3cbb29b8d55eb0f877fc3f463e507f1",
        },
      ],
    },
  },
  balanceCheckIntervalMs: Number(process.env.BALANCE_CHECK_INTERVAL_MS) || 60000,
}

export const isEvmChainConfig = (config: ChainConfig): config is EvmChainConfig => {
  return config.type === ChainConfigType.EVM
}

export const isAztecChainConfig = (config: ChainConfig): config is AztecChainConfig => {
  return config.type === ChainConfigType.AZTEC
}

export const getChainConfig = <T extends ChainConfig = ChainConfig>(name: string): T => {
  const chain = Object.values(config.chains).find((c) => c.name.toLowerCase() === name.toLowerCase()) as T
  if (!chain) {
    throw new Error(`Chain config not found for chain name: ${name}`)
  }
  return chain
}

export const isTokenSupported = (chainConfig: ChainConfig, tokenAddress: string): boolean => {
  return chainConfig.tokens.some((t) => t.address.toLowerCase() === tokenAddress.toLowerCase())
}
