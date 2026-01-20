import { baseSepolia, sepolia } from "viem/chains"
import type { Chain, Hex } from "viem"
import * as chains from "viem/chains"
import * as fs from "fs"
import * as path from "path"

import { ChainType, type InternalChain, type AztecChain } from "./types"

interface DeploymentJson {
  Poseidon2?: { address: string; deployTx: string }
  L2Gateway7683?: { address: string; deployTx: string; configTxs?: string[] }
  Forwarder?: { address: string; deployTx: string; configTx?: string }
  AztecGateway7683?: { address: string; deployTx: string }
}

interface TokensDeploymentJson {
  EVMToken?: { address: string; deployTx: string }
  AztecToken?: { address: string; deployTx: string }
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
  type: ChainType.EVM
  chain: Chain
  gatewayAddress: Hex
}

export interface AztecChainConfig extends BaseChainConfig {
  type: ChainType.AZTEC
  gatewayAddress: Hex
}

export type ChainConfig = EvmChainConfig | AztecChainConfig

export interface SdkConfig {
  chains: {
    aztec: AztecChainConfig
    evm: EvmChainConfig
  }
  forwarderAddress: Hex
  forwarderChain: Chain
  aztecRollupContractL1Address: Hex
  opStackAnchorRegistryAddress: Hex
  l1ChainId: number
}

function findLatestDeploymentFile(baseDir: string, pattern: RegExp): string | null {
  const deploymentsDir = path.resolve(baseDir, "deployments")
  if (!fs.existsSync(deploymentsDir)) {
    return null
  }

  const files = fs
    .readdirSync(deploymentsDir)
    .filter((f) => pattern.test(f))
    .sort()
    .reverse()

  const firstFile = files[0]
  return firstFile ? path.join(deploymentsDir, firstFile) : null
}

function loadDeploymentJson(filePath: string): DeploymentJson | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch (e) {
    console.warn(`Failed to load deployment config from ${filePath}:`, e)
    return null
  }
}

function loadTokensJson(filePath: string): TokensDeploymentJson | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch (e) {
    console.warn(`Failed to load tokens config from ${filePath}:`, e)
    return null
  }
}

function getChainById(chainId: number): Chain {
  const chain = (Object.values(chains) as Chain[]).find(({ id }) => id === chainId)
  if (!chain) {
    throw new Error(`Chain not found for ID: ${chainId}`)
  }
  return chain
}

export interface SdkConfigInput {
  deploymentJsonPath?: string
  tokensJsonPath?: string
  aztecRpcUrl: string
  evmL2RpcUrl: string
  evmL2ChainId?: number
  forwarderChainId?: number
  l2EvmGatewayAddress?: Hex
  aztecGatewayAddress?: Hex
  forwarderAddress?: Hex
  aztecTokenAddress?: Hex
  evmTokenAddress?: Hex
  aztecRollupContractL1Address?: Hex
  opStackAnchorRegistryAddress?: Hex
  aztecChainId?: number
  baseDir?: string
}

const DEFAULT_AZTEC_CHAIN_ID = 999999
const DEFAULT_EVM_L2_CHAIN_ID = baseSepolia.id
const DEFAULT_FORWARDER_CHAIN_ID = sepolia.id

const DEFAULT_AZTEC_ROLLUP_L1_ADDRESS: Hex = "0xb05f36c9dffa76f0af639385ef44d5560e0160c1"
const DEFAULT_OP_STACK_ANCHOR_REGISTRY: Hex = "0x0729957c92A1F50590A84cb2D65D761093f3f8eB"

export function createSdkConfig(input: SdkConfigInput): SdkConfig {
  const baseDir = input.baseDir || process.cwd()

  let deployment: DeploymentJson | null = null
  let tokens: TokensDeploymentJson | null = null

  if (input.deploymentJsonPath) {
    deployment = loadDeploymentJson(input.deploymentJsonPath)
    if (deployment) {
      console.log(`Loaded deployment config from: ${input.deploymentJsonPath}`)
    }
  } else {
    const autoDeploymentPath = findLatestDeploymentFile(baseDir, /^deploy_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/)
    if (autoDeploymentPath) {
      deployment = loadDeploymentJson(autoDeploymentPath)
      if (deployment) {
        console.log(`Auto-loaded deployment config from: ${autoDeploymentPath}`)
      }
    }
  }

  if (input.tokensJsonPath) {
    tokens = loadTokensJson(input.tokensJsonPath)
    if (tokens) {
      console.log(`Loaded tokens config from: ${input.tokensJsonPath}`)
    }
  } else {
    const autoTokensPath = findLatestDeploymentFile(
      baseDir,
      /^tokens_deploy_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/,
    )
    if (autoTokensPath) {
      tokens = loadTokensJson(autoTokensPath)
      if (tokens) {
        console.log(`Auto-loaded tokens config from: ${autoTokensPath}`)
      }
    }
  }

  const evmL2ChainId = input.evmL2ChainId ?? DEFAULT_EVM_L2_CHAIN_ID
  const forwarderChainId = input.forwarderChainId ?? DEFAULT_FORWARDER_CHAIN_ID
  const aztecChainId = input.aztecChainId ?? DEFAULT_AZTEC_CHAIN_ID

  const l2EvmGatewayAddress = input.l2EvmGatewayAddress ?? (deployment?.L2Gateway7683?.address as Hex | undefined)
  const aztecGatewayAddress = input.aztecGatewayAddress ?? (deployment?.AztecGateway7683?.address as Hex | undefined)
  const forwarderAddress = input.forwarderAddress ?? (deployment?.Forwarder?.address as Hex | undefined)

  const aztecTokenAddress = input.aztecTokenAddress ?? (tokens?.AztecToken?.address as Hex | undefined)
  const evmTokenAddress = input.evmTokenAddress ?? (tokens?.EVMToken?.address as Hex | undefined)

  if (!l2EvmGatewayAddress) {
    throw new Error("Missing L2 EVM Gateway address. Provide via config or deployment JSON.")
  }
  if (!aztecGatewayAddress) {
    throw new Error("Missing Aztec Gateway address. Provide via config or deployment JSON.")
  }
  if (!forwarderAddress) {
    throw new Error("Missing Forwarder address. Provide via config or deployment JSON.")
  }

  const evmL2Chain = getChainById(evmL2ChainId)
  const forwarderChain = getChainById(forwarderChainId)

  return {
    chains: {
      aztec: {
        type: ChainType.AZTEC,
        id: aztecChainId,
        name: "Aztec",
        rpcUrl: input.aztecRpcUrl,
        gatewayAddress: aztecGatewayAddress,
        tokens: aztecTokenAddress ? [{ name: "Token", symbol: "TKN", decimals: 18, address: aztecTokenAddress }] : [],
      },
      evm: {
        type: ChainType.EVM,
        id: evmL2ChainId,
        name: evmL2Chain.name,
        rpcUrl: input.evmL2RpcUrl,
        chain: evmL2Chain,
        gatewayAddress: l2EvmGatewayAddress,
        tokens: evmTokenAddress ? [{ name: "Token", symbol: "TKN", decimals: 18, address: evmTokenAddress }] : [],
      },
    },
    forwarderAddress,
    forwarderChain,
    aztecRollupContractL1Address: input.aztecRollupContractL1Address ?? DEFAULT_AZTEC_ROLLUP_L1_ADDRESS,
    opStackAnchorRegistryAddress: input.opStackAnchorRegistryAddress ?? DEFAULT_OP_STACK_ANCHOR_REGISTRY,
    l1ChainId: forwarderChainId,
  }
}

export function configToInternalChains(config: SdkConfig): Record<string, InternalChain> {
  const aztecChain: AztecChain = {
    id: Number(config.chains.aztec.id),
    name: config.chains.aztec.name,
    rpcUrls: {
      default: {
        http: [config.chains.aztec.rpcUrl],
      },
    },
  }

  return {
    aztecDevnet: {
      type: ChainType.AZTEC,
      chain: aztecChain,
      gatewayAddress: config.chains.aztec.gatewayAddress,
    },
    baseSepolia: {
      type: ChainType.EVM,
      chain: config.chains.evm.chain,
      gatewayAddress: config.chains.evm.gatewayAddress,
    },
  }
}

export const isEvmChainConfig = (config: ChainConfig): config is EvmChainConfig => {
  return config.type === ChainType.EVM
}

export const isAztecChainConfig = (config: ChainConfig): config is AztecChainConfig => {
  return config.type === ChainType.AZTEC
}
