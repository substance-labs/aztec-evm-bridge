#!/usr/bin/env node
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"
import { createLogger } from "./logger.js"
import { loadJsonFile, loadEnvVars, type DeploymentAddresses, type TokenAddresses } from "./utils.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..", "..", "..")
config({ path: resolve(projectRoot, ".env") })

const logger = createLogger("test-bridge")

interface TestConfig {
  deploymentFile: string
  tokensFile?: string
  env: ReturnType<typeof loadEnvVars>
  deployment: DeploymentAddresses
  tokens: {
    aztecTokenAddress: string
    l2EvmTokenAddress: string
  }
}

function parseArgs(): { deploymentFile: string; tokensFile?: string } {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error("Usage: test-bridge <path-to-deployment-json> [path-to-tokens-json]")
    process.exit(1)
  }

  return {
    deploymentFile: args[0],
    tokensFile: args[1],
  }
}

function loadConfig(): TestConfig {
  const args = parseArgs()
  const env = loadEnvVars()

  logger.info(`Reading deployment from ${args.deploymentFile}...`)
  const deployment = loadJsonFile<DeploymentAddresses>(args.deploymentFile)

  let aztecTokenAddress: string
  let l2EvmTokenAddress: string

  if (args.tokensFile) {
    logger.info(`Reading tokens from ${args.tokensFile}...`)
    const tokens = loadJsonFile<TokenAddresses>(args.tokensFile)
    aztecTokenAddress = tokens.AztecToken.address
    l2EvmTokenAddress = tokens.EVMToken.address
  } else {
    aztecTokenAddress = process.env.AZTEC_TOKEN_ADDRESS || ""
    l2EvmTokenAddress = process.env.L2_EVM_TOKEN_ADDRESS || ""

    if (!aztecTokenAddress || !l2EvmTokenAddress) {
      throw new Error(
        "Token addresses not provided. Either pass tokens JSON file or set AZTEC_TOKEN_ADDRESS and L2_EVM_TOKEN_ADDRESS env vars",
      )
    }
  }

  logger.info(`L2 Gateway: ${deployment.L2Gateway7683.address}`)
  logger.info(`Aztec Gateway: ${deployment.AztecGateway7683.address}`)
  logger.info(`EVM Token: ${l2EvmTokenAddress}`)
  logger.info(`Aztec Token: ${aztecTokenAddress}`)

  return {
    deploymentFile: args.deploymentFile,
    tokensFile: args.tokensFile,
    env,
    deployment,
    tokens: {
      aztecTokenAddress,
      l2EvmTokenAddress,
    },
  }
}

function runScript(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const projectRoot = resolve(__dirname, "..", "..", "..")
    const scriptDir = resolve(projectRoot, "packages", "aztec", "aztec_gateway_7683")
    const scriptFullPath = resolve(scriptDir, "scripts", scriptPath)

    const child = spawn("node", ["--loader", "ts-node/esm", scriptFullPath, ...args], {
      stdio: "inherit",
      cwd: scriptDir,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
      },
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`Script ${scriptPath} exited with code ${code}`))
      }
    })

    child.on("error", reject)
  })
}

async function main() {
  try {
    const config = loadConfig()

    logger.info("")
    logger.info("=== Deploying Filler Account (if not already deployed) ===")
    await runScript("deploy-account.ts", [
      config.env.aztecFillerSecretKey,
      config.env.aztecFillerSalt,
      config.env.aztecRpcUrl,
    ])

    logger.info("")
    logger.info("=== Deploying E2E Test Account (if not already deployed) ===")
    await runScript("deploy-account.ts", [
      config.env.aztecE2ETestSecretKey,
      config.env.aztecE2ETestSalt,
      config.env.aztecRpcUrl,
    ])

    logger.info("")
    logger.info("=== Ensuring Filler Account has sufficient balance ===")
    await runScript("ensure-balance.ts", [
      config.env.aztecSecretKey,
      config.env.aztecSalt,
      config.tokens.aztecTokenAddress,
      config.env.aztecFillerAddress,
      "1000000000000000000",
      "1000000000000000000",
      config.env.aztecRpcUrl,
    ])

    logger.info("")
    logger.info("=== Ensuring E2E Test Account has sufficient balance ===")
    await runScript("ensure-balance.ts", [
      config.env.aztecSecretKey,
      config.env.aztecSalt,
      config.tokens.aztecTokenAddress,
      config.env.aztecE2ETestAddress,
      "1000000000000000000",
      "1000000000000000000",
      config.env.aztecRpcUrl,
    ])

    logger.info("")
    logger.info("=== Test 1/4: Aztec to EVM (PUBLIC) ===")
    await runScript("e2e/aztec-to-evm.ts", [
      config.env.aztecE2ETestSecretKey,
      config.env.aztecE2ETestSalt,
      config.deployment.AztecGateway7683.address,
      config.deployment.L2Gateway7683.address,
      config.env.l2ChainId,
      config.tokens.aztecTokenAddress,
      config.tokens.l2EvmTokenAddress,
      config.env.evmE2ETestAddress,
      "0",
      config.env.aztecRpcUrl,
    ])
    logger.info("✅ Aztec to EVM (PUBLIC) test passed!")

    logger.info("")
    logger.info("=== Test 2/4: Aztec to EVM (PRIVATE) ===")
    await runScript("e2e/aztec-to-evm.ts", [
      config.env.aztecE2ETestSecretKey,
      config.env.aztecE2ETestSalt,
      config.deployment.AztecGateway7683.address,
      config.deployment.L2Gateway7683.address,
      config.env.l2ChainId,
      config.tokens.aztecTokenAddress,
      config.tokens.l2EvmTokenAddress,
      config.env.evmE2ETestAddress,
      "1",
      config.env.aztecRpcUrl,
    ])
    logger.info("✅ Aztec to EVM (PRIVATE) test passed!")

    logger.info("")
    logger.info("=== Test 3/4: EVM to Aztec (PUBLIC) ===")
    await runScript("e2e/evm-to-aztec.ts", [
      config.env.aztecE2ETestSecretKey,
      config.env.aztecE2ETestSalt,
      config.env.evmE2ETestPk,
      config.deployment.AztecGateway7683.address,
      config.deployment.L2Gateway7683.address,
      config.env.l2ChainId,
      config.tokens.aztecTokenAddress,
      config.tokens.l2EvmTokenAddress,
      config.env.aztecE2ETestAddress,
      "0",
      "",
      "",
      config.env.aztecRpcUrl,
    ])
    logger.info("✅ EVM to Aztec (PUBLIC) test passed!")

    logger.info("")
    logger.info("=== Test 4/4: EVM to Aztec (PRIVATE) ===")
    await runScript("e2e/evm-to-aztec.ts", [
      config.env.aztecE2ETestSecretKey,
      config.env.aztecE2ETestSalt,
      config.env.evmE2ETestPk,
      config.deployment.AztecGateway7683.address,
      config.deployment.L2Gateway7683.address,
      config.env.l2ChainId,
      config.tokens.aztecTokenAddress,
      config.tokens.l2EvmTokenAddress,
      config.env.aztecE2ETestAddress,
      "1",
      "",
      "",
      config.env.aztecRpcUrl,
    ])
    logger.info("✅ EVM to Aztec (PRIVATE) test passed!")

    logger.info("")
    logger.info("🎉 All 4 E2E tests passed!")
  } catch (error) {
    logger.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Uncaught error:", error)
  process.exit(1)
})
