#!/usr/bin/env node
import { config } from "dotenv"
import { resolve } from "path"
import { readFileSync } from "fs"
import { createLogger } from "./logger.js"
import {
  projectRoot,
  checkEnvVar,
  getEnvVar,
  exec,
  runScript,
  saveJsonFile,
  getTimestamp,
  type TokenDeployment,
} from "./utils.js"

config({ path: resolve(projectRoot, ".env") })

const logger = createLogger("deploy-tokens")

type DeployType = "all" | "evm" | "aztec"

interface DeployConfig {
  deployType: DeployType
  privateKey: string
  l2RpcUrl: string
  aztecSecretKey: string
  aztecSalt: string
  aztecRpcUrl: string
  evmE2ETestAddress?: string
  evmFillerAddress?: string
  aztecE2ETestAddress?: string
  aztecFillerAddress?: string
  verifyContracts: boolean
}

function loadConfig(): DeployConfig {
  const deployType = (process.argv[2] || "all") as DeployType
  if (!["all", "evm", "aztec"].includes(deployType)) {
    console.error("Usage: deploy-tokens [all|evm|aztec]")
    process.exit(1)
  }

  return {
    deployType,
    privateKey: checkEnvVar("PRIVATE_KEY"),
    l2RpcUrl: checkEnvVar("L2_RPC_URL"),
    aztecSecretKey: checkEnvVar("AZTEC_SECRET_KEY"),
    aztecSalt: checkEnvVar("AZTEC_SALT"),
    aztecRpcUrl: checkEnvVar("AZTEC_RPC_URL"),
    evmE2ETestAddress: getEnvVar("EVM_E2E_TEST_ADDRESS"),
    evmFillerAddress: getEnvVar("EVM_FILLER_ADDRESS"),
    aztecE2ETestAddress: getEnvVar("AZTEC_E2E_TEST_ADDRESS"),
    aztecFillerAddress: getEnvVar("AZTEC_FILLER_ADDRESS"),
    verifyContracts: getEnvVar("VERIFY_CONTRACTS", "false") === "true",
  }
}

async function deployEvmToken(config: DeployConfig): Promise<{ address: string; txHash?: string }> {
  logger.info("Deploying EVM Test Token...")
  const evmDir = resolve(projectRoot, "packages", "evm")

  const output = exec(
    `forge create --broadcast --private-key ${config.privateKey} --rpc-url ${config.l2RpcUrl} ` +
      `src/TestToken.sol:TestToken --constructor-args "Test Token" "TEST" 18 1000000000000000000000000`,
    evmDir,
  )

  const addressMatch = output.match(/Deployed to:\s*(0x[a-fA-F0-9]+)/)
  const txMatch = output.match(/Transaction hash:\s*(0x[a-fA-F0-9]+)/)

  if (!addressMatch) {
    throw new Error("Failed to parse EVM token deployment address")
  }

  const address = addressMatch[1]
  logger.info(`EVM Token deployed at: ${address}`)

  await new Promise((r) => setTimeout(r, 5000))

  return { address, txHash: txMatch?.[1] }
}

async function transferEvmTokens(
  config: DeployConfig,
  tokenAddress: string,
  recipient: string,
  amount: string,
): Promise<void> {
  logger.info(`Transferring ${amount} EVM tokens to ${recipient}...`)
  const evmDir = resolve(projectRoot, "packages", "evm")

  exec(
    `cast send --confirmations 1 --private-key ${config.privateKey} --rpc-url ${config.l2RpcUrl} ` +
      `${tokenAddress} "transfer(address,uint256)" ${recipient} ${amount}`,
    evmDir,
  )

  logger.info(`Transferred tokens to ${recipient}`)
  await new Promise((r) => setTimeout(r, 3000))
}

async function deployAztecToken(config: DeployConfig): Promise<{ address: string; txHash?: string }> {
  logger.info("Deploying Aztec Test Token...")

  const aztecDir = resolve(projectRoot, "packages", "aztec", "aztec_gateway_7683")

  await runScript("deploy-token.ts", [
    config.aztecSecretKey,
    config.aztecSalt,
    "Test Token",
    "TEST",
    "18",
    config.aztecRpcUrl,
  ])

  const deploymentJson = resolve(aztecDir, "deployments", "token_deployment.json")
  const deployment = JSON.parse(readFileSync(deploymentJson, "utf-8"))

  if (!deployment.Token) {
    throw new Error("Failed to find Token in token_deployment.json")
  }

  const address = deployment.Token
  logger.info(`Aztec Token deployed at: ${address}`)

  return { address }
}

async function mintAztecTokens(
  config: DeployConfig,
  tokenAddress: string,
  recipient: string,
  privateAmount: string,
  publicAmount: string,
): Promise<void> {
  logger.info(`Minting Aztec tokens to ${recipient}...`)

  await runScript("mint-tokens.ts", [
    config.aztecSecretKey,
    config.aztecSalt,
    tokenAddress,
    recipient,
    privateAmount,
    publicAmount,
    config.aztecRpcUrl,
  ])

  logger.info(`Minted tokens to ${recipient}`)
}

async function main() {
  try {
    logger.info("Starting token deployment...")
    const deployConfig = loadConfig()

    const deployment: TokenDeployment = {}
    const MINT_AMOUNT = "10000000000000000000000"

    if (deployConfig.deployType === "all" || deployConfig.deployType === "evm") {
      const evmToken = await deployEvmToken(deployConfig)
      deployment.EVMToken = {
        address: evmToken.address,
        deployTx: evmToken.txHash,
      }
    }

    if (deployConfig.deployType === "all" || deployConfig.deployType === "aztec") {
      const aztecToken = await deployAztecToken(deployConfig)
      deployment.AztecToken = {
        address: aztecToken.address,
        deployTx: aztecToken.txHash,
      }
    }

    const timestamp = getTimestamp()
    const outputFile = `deployments/tokens_deploy_${timestamp}.json`
    saveJsonFile(outputFile, deployment)
    logger.info(`Deployment saved to: ${outputFile}`)

    if (deployment.EVMToken) {
      if (deployConfig.evmE2ETestAddress) {
        await transferEvmTokens(deployConfig, deployment.EVMToken.address, deployConfig.evmE2ETestAddress, MINT_AMOUNT)
      }

      if (deployConfig.evmFillerAddress) {
        await transferEvmTokens(deployConfig, deployment.EVMToken.address, deployConfig.evmFillerAddress, MINT_AMOUNT)
      }
    }

    if (deployment.AztecToken) {
      if (deployConfig.aztecE2ETestAddress) {
        await mintAztecTokens(
          deployConfig,
          deployment.AztecToken.address,
          deployConfig.aztecE2ETestAddress,
          MINT_AMOUNT,
          MINT_AMOUNT,
        )
      }

      if (deployConfig.aztecFillerAddress) {
        await mintAztecTokens(
          deployConfig,
          deployment.AztecToken.address,
          deployConfig.aztecFillerAddress,
          MINT_AMOUNT,
          MINT_AMOUNT,
        )
      }
    }

    logger.info("")
    logger.info("=".repeat(50))
    logger.info("Token Deployment Complete!")
    logger.info("=".repeat(50))
    if (deployment.EVMToken) {
      logger.info(`EVM Token: ${deployment.EVMToken.address}`)
    }
    if (deployment.AztecToken) {
      logger.info(`Aztec Token: ${deployment.AztecToken.address}`)
    }
    logger.info(`Deployment saved to: ${outputFile}`)
    logger.info("")
    logger.info("Add the following to your .env:")
    if (deployment.EVMToken) {
      logger.info(`L2_EVM_TOKEN_ADDRESS=${deployment.EVMToken.address}`)
    }
    if (deployment.AztecToken) {
      logger.info(`AZTEC_TOKEN_ADDRESS=${deployment.AztecToken.address}`)
    }
  } catch (error) {
    logger.error(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

main()
