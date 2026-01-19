import "dotenv/config"
import { baseSepolia, sepolia } from "viem/chains"
import type { Chain } from "viem"
import * as fs from "fs"
import * as path from "path"
import * as chains from "viem/chains"

// Deployment JSON types
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

// MongoDB configuration
export interface MongoConfig {
  uri: string
  user?: string
  password?: string
  authSource?: string
  dbName: string
}

// EVM-specific configuration
export interface EvmConfig {
  privateKey: `0x${string}`
  forwarderRpcUrl: string
  l2ChainId: string
  forwarderChainId: string
  watchIntervalMs: number
  beaconApiUrl: string
  opStackAnchorRegistryAddress: `0x${string}`
  aztecRollupContractL1Address: `0x${string}`
}

// Aztec-specific configuration
export interface AztecConfig {
  secretKey: string
  salt: string
  proverEnabled: boolean
  watchIntervalMs: number
  isSandbox: boolean
}

// Find the latest deployment file matching a pattern
function findLatestDeploymentFile(pattern: RegExp): string | null {
  const deploymentsDir = path.resolve(__dirname, "../../../deployments")
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

// Load deployment configuration from JSON files
function loadDeploymentConfig(): { deployment: DeploymentJson | null; tokens: TokensDeploymentJson | null } {
  let deployment: DeploymentJson | null = null
  let tokens: TokensDeploymentJson | null = null

  // Check for explicit file paths in env vars first
  const deploymentFile =
    process.env.DEPLOYMENT_JSON_PATH || findLatestDeploymentFile(/^deploy_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/)
  const tokensFile =
    process.env.TOKENS_JSON_PATH ||
    findLatestDeploymentFile(/^tokens_deploy_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/)

  if (deploymentFile && fs.existsSync(deploymentFile)) {
    try {
      deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"))
      console.log(`Loaded deployment config from: ${deploymentFile}`)
    } catch (e) {
      console.warn(`Failed to load deployment config from ${deploymentFile}:`, e)
    }
  }

  if (tokensFile && fs.existsSync(tokensFile)) {
    try {
      tokens = JSON.parse(fs.readFileSync(tokensFile, "utf-8"))
      console.log(`Loaded tokens config from: ${tokensFile}`)
    } catch (e) {
      console.warn(`Failed to load tokens config from ${tokensFile}:`, e)
    }
  }

  return { deployment, tokens }
}

const { deployment, tokens } = loadDeploymentConfig()

// Helper function to get required config value or throw
function getRequiredConfig(name: string, ...sources: (string | undefined)[]): string {
  for (const source of sources) {
    if (source) return source
  }
  throw new Error(`Missing required configuration: ${name}. Set via environment variable or deployment JSON.`)
}

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
  chains: { aztec: AztecChainConfig; baseSepolia: EvmChainConfig } & Record<string, ChainConfig>
  forwarderAddress: `0x${string}`
  balanceCheckIntervalMs: number
  mongo: MongoConfig
  evm: EvmConfig
  aztec: AztecConfig
  l2EvmChain: Chain
  l1Chain: Chain
}

// Get chain by ID from viem chains
function getChainById(chainId: string): Chain {
  const chain = (Object.values(chains) as Chain[]).find(({ id }) => id.toString() === chainId)
  if (!chain) {
    throw new Error(`Chain not found for ID: ${chainId}`)
  }
  return chain
}

const evmL2ChainId = getRequiredConfig("EVM_L2_CHAIN_ID", process.env.EVM_L2_CHAIN_ID)
const forwarderChainId = getRequiredConfig("FORWARDER_CHAIN_ID", process.env.FORWARDER_CHAIN_ID)

export const config: FillerConfig = {
  chains: {
    baseSepolia: {
      type: ChainConfigType.EVM,
      id: baseSepolia.id,
      name: baseSepolia.name,
      rpcUrl: getRequiredConfig("EVM_L2_RPC_URL", process.env.EVM_L2_RPC_URL),
      chain: baseSepolia,
      gateway: getRequiredConfig(
        "L2_EVM_GATEWAY_ADDRESS",
        process.env.L2_EVM_GATEWAY_ADDRESS,
        deployment?.L2Gateway7683?.address,
      ) as `0x${string}`,
      tokens: [
        {
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          address: getRequiredConfig(
            "L2_EVM_TOKEN_ADDRESS",
            process.env.L2_EVM_TOKEN_ADDRESS,
            tokens?.EVMToken?.address,
          ),
        },
      ],
    },
    aztec: {
      type: ChainConfigType.AZTEC,
      id: "999999",
      name: "Aztec",
      rpcUrl: getRequiredConfig("AZTEC_RPC_URL", process.env.AZTEC_RPC_URL),
      gateway: getRequiredConfig(
        "AZTEC_GATEWAY_ADDRESS",
        process.env.AZTEC_GATEWAY_ADDRESS,
        deployment?.AztecGateway7683?.address,
      ) as `0x${string}`,
      tokens: [
        {
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          address: getRequiredConfig(
            "AZTEC_TOKEN_ADDRESS",
            process.env.AZTEC_TOKEN_ADDRESS,
            tokens?.AztecToken?.address,
          ),
        },
      ],
    },
  },
  forwarderAddress: getRequiredConfig(
    "FORWARDER_ADDRESS",
    process.env.FORWARDER_ADDRESS,
    deployment?.Forwarder?.address,
  ) as `0x${string}`,
  balanceCheckIntervalMs: Number(process.env.BALANCE_CHECK_INTERVAL_MS) || 60000,
  mongo: {
    uri: process.env.MONGO_DB_URI || "mongodb://localhost:27017",
    user: process.env.MONGO_DB_USER,
    password: process.env.MONGO_DB_PASSWORD,
    authSource: process.env.MONGO_DB_AUTH_SOURCE,
    dbName: process.env.MONGO_DB_NAME || "filler",
  },
  evm: {
    privateKey: getRequiredConfig("PK_EVM", process.env.PK_EVM) as `0x${string}`,
    forwarderRpcUrl: getRequiredConfig("FORWARDER_RPC_URL", process.env.FORWARDER_RPC_URL),
    l2ChainId: evmL2ChainId,
    forwarderChainId: forwarderChainId,
    watchIntervalMs: Number(process.env.EVM_WATCH_INTERVAL_TIME_MS) || 5000,
    beaconApiUrl: getRequiredConfig("BEACON_API_URL", process.env.BEACON_API_URL),
    opStackAnchorRegistryAddress: getRequiredConfig(
      "OP_STACK_ANCHOR_REGISTRY_ADDRESS",
      process.env.OP_STACK_ANCHOR_REGISTRY_ADDRESS,
    ) as `0x${string}`,
    aztecRollupContractL1Address: getRequiredConfig(
      "AZTEC_ROLLUP_CONTRACT_L1_ADDRESS",
      process.env.AZTEC_ROLLUP_CONTRACT_L1_ADDRESS,
    ) as `0x${string}`,
  },
  aztec: {
    secretKey: getRequiredConfig("AZTEC_SECRET_KEY", process.env.AZTEC_SECRET_KEY),
    salt: getRequiredConfig("AZTEC_SALT", process.env.AZTEC_SALT),
    proverEnabled: (process.env.AZTEC_PROVER_ENABLED ?? "").toLowerCase() === "true",
    watchIntervalMs: Number(process.env.AZTEC_WATCH_INTERVAL_TIME_MS) || 5000,
    isSandbox: (process.env.AZTEC_SANDBOX ?? "").toLowerCase() === "true",
  },
  l2EvmChain: getChainById(evmL2ChainId),
  l1Chain: getChainById(forwarderChainId),
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
