#!/usr/bin/env node
import { config } from "dotenv"
import { resolve } from "path"
import { readFileSync, renameSync } from "fs"
import { createLogger } from "./logger.js"
import {
  projectRoot,
  checkEnvVar,
  getEnvVar,
  exec,
  execWithOutput,
  runScript,
  saveJsonFile,
  getTimestamp,
  type BridgeDeployment,
} from "./utils.js"

// Load .env from project root
config({ path: resolve(projectRoot, ".env") })

const logger = createLogger("deploy-bridge")

interface DeployConfig {
  privateKey: string
  permit2: string
  aztecInbox: string
  aztecOutbox: string
  l2AnchorStateRegistry: string
  l2RpcUrl: string
  l1RpcUrl: string
  aztecSecretKey: string
  aztecSalt: string
  aztecRpcUrl: string
  l2ChainId: string
  poseidon2?: string
  verifyContracts: boolean
  etherscanApiKey?: string
  basescanApiKey?: string
}

function loadConfig(): DeployConfig {
  return {
    privateKey: checkEnvVar("PRIVATE_KEY"),
    permit2: checkEnvVar("PERMIT2"),
    aztecInbox: checkEnvVar("AZTEC_INBOX"),
    aztecOutbox: checkEnvVar("AZTEC_OUTBOX"),
    l2AnchorStateRegistry: checkEnvVar("L2_ANCHOR_STATE_REGISTRY"),
    l2RpcUrl: checkEnvVar("L2_RPC_URL"),
    l1RpcUrl: checkEnvVar("L1_RPC_URL"),
    aztecSecretKey: checkEnvVar("AZTEC_SECRET_KEY"),
    aztecSalt: checkEnvVar("AZTEC_SALT"),
    aztecRpcUrl: checkEnvVar("AZTEC_RPC_URL"),
    l2ChainId: checkEnvVar("L2_CHAIN_ID"),
    poseidon2: getEnvVar("POSEIDON2"),
    verifyContracts: getEnvVar("VERIFY_CONTRACTS", "false") === "true",
    etherscanApiKey: getEnvVar("ETHERSCAN_API_KEY"),
    basescanApiKey: getEnvVar("BASESCAN_API_KEY"),
  }
}

async function deployPoseidon2(config: DeployConfig): Promise<{ address: string; txHash?: string; deployed: boolean }> {
  if (config.poseidon2) {
    logger.info(`Using existing Poseidon2 at: ${config.poseidon2}`)
    return { address: config.poseidon2, deployed: false }
  }

  logger.info("Deploying Poseidon2 on Base Sepolia...")
  const evmDir = resolve(projectRoot, "packages", "evm")
  const verifyFlag = config.verifyContracts ? "--verify" : ""

  const output = exec(
    `forge create --broadcast --private-key ${config.privateKey} --rpc-url ${config.l2RpcUrl} src/libs/Poseidon2.sol:Poseidon2 ${verifyFlag}`,
    evmDir,
  )

  const addressMatch = output.match(/Deployed to:\s*(0x[a-fA-F0-9]+)/)
  const txMatch = output.match(/Transaction hash:\s*(0x[a-fA-F0-9]+)/)

  if (!addressMatch) {
    throw new Error("Failed to parse Poseidon2 deployment address")
  }

  const address = addressMatch[1]
  logger.info(`Poseidon2 deployed at: ${address}`)
  return { address, txHash: txMatch?.[1], deployed: true }
}

async function deployL2Gateway(config: DeployConfig, poseidon2: string): Promise<{ address: string; txHash?: string }> {
  logger.info("Deploying L2Gateway7683 on Base Sepolia...")
  const evmDir = resolve(projectRoot, "packages", "evm")
  const verifyFlag = config.verifyContracts ? "--verify" : ""

  exec(
    `forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url ${config.l2RpcUrl} ${verifyFlag} ` +
      `--libraries src/libs/Poseidon2.sol:Poseidon2:${poseidon2} ` +
      `--sig "run(address,address,address,address,bytes32,bool,bool,bool,address)" ` +
      `${config.permit2} ${config.aztecInbox} ${config.aztecOutbox} ${config.l2AnchorStateRegistry} ` +
      `"0x0000000000000000000000000000000000000000000000000000000000000000" false true false ` +
      `"0x0000000000000000000000000000000000000000"`,
    evmDir,
  )

  const deploymentJson = resolve(evmDir, "deployments", "deployment.json")
  const deployment = JSON.parse(readFileSync(deploymentJson, "utf-8"))
  const address = deployment.L2Gateway7683

  const l2ChainId = exec(`cast chain-id --rpc-url ${config.l2RpcUrl}`, evmDir).trim()
  const broadcastJson = resolve(evmDir, "broadcast", "Deploy.s.sol", l2ChainId, "run-latest.json")
  const broadcast = JSON.parse(readFileSync(broadcastJson, "utf-8"))
  const txHash = broadcast.transactions?.find((t: { contractName: string }) => t.contractName === "L2Gateway7683")?.hash

  // Rename to avoid conflicts
  renameSync(deploymentJson, resolve(evmDir, "deployments", "deployment_l2.json"))

  logger.info(`L2Gateway7683 deployed at: ${address}`)
  return { address, txHash }
}

async function deployForwarder(
  config: DeployConfig,
  l2GatewayAddress: string,
): Promise<{ address: string; txHash?: string }> {
  logger.info("Deploying Forwarder on Eth Sepolia...")
  const evmDir = resolve(projectRoot, "packages", "evm")
  const verifyFlag = config.verifyContracts ? "--verify" : ""

  exec(
    `forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url ${config.l1RpcUrl} ${verifyFlag} ` +
      `--sig "run(address,address,address,address,bytes32,bool,bool,bool,address)" ` +
      `${config.permit2} ${config.aztecInbox} ${config.aztecOutbox} ${config.l2AnchorStateRegistry} ` +
      `"0x0000000000000000000000000000000000000000000000000000000000000000" false false true ` +
      `${l2GatewayAddress}`,
    evmDir,
  )

  const deploymentJson = resolve(evmDir, "deployments", "deployment.json")
  const deployment = JSON.parse(readFileSync(deploymentJson, "utf-8"))
  const address = deployment.Forwarder

  const l1ChainId = exec(`cast chain-id --rpc-url ${config.l1RpcUrl}`, evmDir).trim()
  const broadcastJson = resolve(evmDir, "broadcast", "Deploy.s.sol", l1ChainId, "run-latest.json")
  const broadcast = JSON.parse(readFileSync(broadcastJson, "utf-8"))
  const txHash = broadcast.transactions?.find((t: { contractName: string }) => t.contractName === "Forwarder")?.hash

  // Rename to avoid conflicts
  renameSync(deploymentJson, resolve(evmDir, "deployments", "deployment_l1.json"))

  logger.info(`Forwarder deployed at: ${address}`)
  return { address, txHash }
}

async function deployAztecGateway(
  config: DeployConfig,
  l2GatewayAddress: string,
  forwarderAddress: string,
): Promise<{ address: string; txHash?: string }> {
  logger.info("Deploying Aztec Gateway...")

  const aztecDir = resolve(projectRoot, "packages", "aztec", "aztec_gateway_7683")

  await runScript("deploy.ts", [
    config.aztecSecretKey,
    config.aztecSalt,
    l2GatewayAddress,
    config.l2ChainId,
    forwarderAddress,
    config.aztecRpcUrl,
    "true", // deployWallet
    "false", // deployToken
  ])

  // Read deployment address from file (deploy.ts saves to deployments/deployment.json)
  const deploymentJson = resolve(aztecDir, "deployments", "deployment.json")
  const deployment = JSON.parse(readFileSync(deploymentJson, "utf-8"))

  if (!deployment.AztecGateway7683) {
    throw new Error("Failed to find AztecGateway7683 in deployment.json")
  }

  const address = deployment.AztecGateway7683
  const txHash = deployment.AztecGatewayDeploymentTx
  logger.info(`Aztec Gateway deployed at: ${address}`)
  return { address, txHash }
}

async function configureContracts(
  config: DeployConfig,
  l2GatewayAddress: string,
  forwarderAddress: string,
  aztecGatewayAddress: string,
): Promise<{ forwarderConfigTx?: string; l2GatewayConfigTxs?: string[] }> {
  logger.info("Configuring contracts...")
  const evmDir = resolve(projectRoot, "packages", "evm")

  // Configure Forwarder on L1
  logger.info("Setting Aztec Gateway on Forwarder...")
  exec(
    `forge script script/Config.s.sol:Config --broadcast --rpc-url ${config.l1RpcUrl} ` +
      `--sig "run(address,address,bytes32,bool,bool)" ` +
      `"0x0000000000000000000000000000000000000000" ${forwarderAddress} ${aztecGatewayAddress} true false`,
    evmDir,
  )

  const l1ChainId = exec(`cast chain-id --rpc-url ${config.l1RpcUrl}`, evmDir).trim()
  const l1BroadcastJson = resolve(evmDir, "broadcast", "Config.s.sol", l1ChainId, "run-latest.json")
  const l1Broadcast = JSON.parse(readFileSync(l1BroadcastJson, "utf-8"))
  const forwarderConfigTx = l1Broadcast.transactions?.find(
    (t: { function: string }) => t.function === "setAztecGateway7683(bytes32)",
  )?.hash

  // Configure L2Gateway
  logger.info("Setting Aztec Gateway and Forwarder on L2Gateway7683...")
  exec(
    `forge script script/Config.s.sol:Config --broadcast --rpc-url ${config.l2RpcUrl} ` +
      `--sig "run(address,address,bytes32,bool,bool)" ` +
      `${l2GatewayAddress} ${forwarderAddress} ${aztecGatewayAddress} false true`,
    evmDir,
  )

  const l2ChainId = exec(`cast chain-id --rpc-url ${config.l2RpcUrl}`, evmDir).trim()
  const l2BroadcastJson = resolve(evmDir, "broadcast", "Config.s.sol", l2ChainId, "run-latest.json")
  const l2Broadcast = JSON.parse(readFileSync(l2BroadcastJson, "utf-8"))
  const l2GatewayConfigTxs = l2Broadcast.transactions?.map((t: { hash: string }) => t.hash) || []

  logger.info("Contract configuration complete")
  return { forwarderConfigTx, l2GatewayConfigTxs }
}

async function main() {
  try {
    logger.info("Starting bridge deployment...")
    const deployConfig = loadConfig()

    // 1. Deploy Poseidon2
    const poseidon2 = await deployPoseidon2(deployConfig)

    // 2. Deploy L2Gateway7683
    const l2Gateway = await deployL2Gateway(deployConfig, poseidon2.address)

    // 3. Deploy Forwarder
    const forwarder = await deployForwarder(deployConfig, l2Gateway.address)

    // 4. Deploy Aztec Gateway
    const aztecGateway = await deployAztecGateway(deployConfig, l2Gateway.address, forwarder.address)

    // 5. Configure contracts
    const configResult = await configureContracts(
      deployConfig,
      l2Gateway.address,
      forwarder.address,
      aztecGateway.address,
    )

    // Save deployment result
    const timestamp = getTimestamp()
    const outputFile = `deployments/deploy_${timestamp}.json`

    const deployment: BridgeDeployment = {
      L2Gateway7683: {
        address: l2Gateway.address,
        deployTx: l2Gateway.txHash,
        configTxs: configResult.l2GatewayConfigTxs,
      },
      Forwarder: {
        address: forwarder.address,
        deployTx: forwarder.txHash,
        configTx: configResult.forwarderConfigTx,
      },
      AztecGateway7683: {
        address: aztecGateway.address,
        deployTx: aztecGateway.txHash,
      },
    }

    if (poseidon2.deployed) {
      deployment.Poseidon2 = {
        address: poseidon2.address,
        deployTx: poseidon2.txHash,
        deployed: true,
      }
    }

    saveJsonFile(outputFile, deployment)

    logger.info("")
    logger.info("=".repeat(50))
    logger.info("Bridge Deployment Complete!")
    logger.info("=".repeat(50))
    logger.info(`L2Gateway7683: ${l2Gateway.address}`)
    logger.info(`Forwarder: ${forwarder.address}`)
    logger.info(`AztecGateway7683: ${aztecGateway.address}`)
    logger.info(`Deployment saved to: ${outputFile}`)
  } catch (error) {
    logger.error(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

main()
