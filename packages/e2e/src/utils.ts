import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..", "..", "..")

export interface DeploymentAddresses {
  L2Gateway7683: { address: string }
  AztecGateway7683: { address: string }
}

export interface TokenAddresses {
  EVMToken: { address: string }
  AztecToken: { address: string }
}

export function loadJsonFile<T>(filePath: string): T {
  const absolutePath = filePath.startsWith("/") ? filePath : resolve(projectRoot, filePath)
  const content = readFileSync(absolutePath, "utf-8")
  return JSON.parse(content) as T
}

export function checkEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`)
  }
  return value
}

export function loadEnvVars() {
  return {
    aztecE2ETestSecretKey: checkEnvVar("AZTEC_E2E_TEST_SECRET_KEY"),
    aztecE2ETestSalt: checkEnvVar("AZTEC_E2E_TEST_SALT"),
    aztecE2ETestAddress: checkEnvVar("AZTEC_E2E_TEST_ADDRESS"),
    evmE2ETestPk: checkEnvVar("EVM_E2E_TEST_PK"),
    evmE2ETestAddress: checkEnvVar("EVM_E2E_TEST_ADDRESS"),
    aztecSecretKey: checkEnvVar("AZTEC_SECRET_KEY"),
    aztecSalt: checkEnvVar("AZTEC_SALT"),
    aztecFillerSecretKey: checkEnvVar("AZTEC_FILLER_SECRET_KEY"),
    aztecFillerSalt: checkEnvVar("AZTEC_FILLER_SALT"),
    aztecFillerAddress: checkEnvVar("AZTEC_FILLER_ADDRESS"),
    l2ChainId: checkEnvVar("L2_CHAIN_ID"),
    aztecRpcUrl: checkEnvVar("AZTEC_RPC_URL"),
  }
}
