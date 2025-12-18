import type { Hex } from "viem"
import * as evmChains from "viem/chains"
import { chainsConfig, PRIVATE_ORDER, PUBLIC_ORDER } from "../constants"
import type { InternalChain, SwapMode } from "../types"

export class BridgeHelpers {
  static getChainInAndOutByChainIds(
    chainIdIn: number,
    chainIdOut: number,
  ): { chainIn: InternalChain; chainOut: InternalChain } {
    return {
      chainIn: BridgeHelpers.getChainByChainId(chainIdIn),
      chainOut: BridgeHelpers.getChainByChainId(chainIdOut),
    }
  }

  static getChainByChainId(chainId: number): InternalChain {
    const chainConfig = Object.values(chainsConfig).find((config) => config.chain.id === chainId)
    if (chainConfig) {
      return chainConfig
    }
    throw new Error(`Chain not found for chainId: ${chainId}`)
  }

  static getOrderType(mode: SwapMode): number {
    switch (mode) {
      case "public":
      case "publicWithHook":
        return PUBLIC_ORDER
      case "private":
      case "privateWithHook":
        return PRIVATE_ORDER
      default:
        throw new Error(`Invalid order mode: ${mode}`)
    }
  }

  static getGatewaysByChainIds(chainIdIn: number, chainIdOut: number): { gatewayIn: Hex; gatewayOut: Hex } {
    const chainIn = Object.values(chainsConfig).find((c) => c.chain.id === chainIdIn)
    const chainOut = Object.values(chainsConfig).find((c) => c.chain.id === chainIdOut)

    if (!chainIn || !chainIn.gatewayAddress) {
      throw new Error(`Gateway not found for chain ${chainIdIn}`)
    }
    if (!chainOut || !chainOut.gatewayAddress) {
      throw new Error(`Gateway not found for chain ${chainIdOut}`)
    }

    return {
      gatewayIn: chainIn.gatewayAddress,
      gatewayOut: chainOut.gatewayAddress,
    }
  }
}
