import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync, spawn, SpawnOptions } from "child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
export const projectRoot = resolve(__dirname, "..", "..", "..")

export function checkEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`)
  }
  return value
}

export function getEnvVar(name: string, defaultValue?: string): string | undefined {
  return process.env[name] ?? defaultValue
}

export function loadJsonFile<T>(filePath: string): T {
  const absolutePath = filePath.startsWith("/") ? filePath : resolve(projectRoot, filePath)
  const content = readFileSync(absolutePath, "utf-8")
  return JSON.parse(content) as T
}

export function saveJsonFile(filePath: string, data: unknown): void {
  const absolutePath = filePath.startsWith("/") ? filePath : resolve(projectRoot, filePath)
  const dir = dirname(absolutePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(absolutePath, JSON.stringify(data, null, 2))
}

export function getTimestamp(): string {
  const now = new Date()
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "_")
}

export function exec(command: string, cwd?: string): string {
  return execSync(command, {
    cwd: cwd ?? projectRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  })
}

export function execWithOutput(command: string, cwd?: string): string {
  return execSync(command, {
    cwd: cwd ?? projectRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "inherit"],
  })
}

export function runScript(scriptPath: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const scriptDir = cwd ?? resolve(projectRoot, "packages", "aztec", "aztec_gateway_7683")
    const scriptFullPath = resolve(scriptDir, "scripts", scriptPath)

    let output = ""
    const child = spawn("node", ["--loader", "ts-node/esm", scriptFullPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: scriptDir,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
      },
    } as SpawnOptions)

    child.stdout?.on("data", (data) => {
      const text = data.toString()
      output += text
      process.stdout.write(text)
    })

    child.stderr?.on("data", (data) => {
      const text = data.toString()
      process.stderr.write(text)
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(output)
      } else {
        reject(new Error(`Script ${scriptPath} exited with code ${code}`))
      }
    })

    child.on("error", reject)
  })
}

export interface DeploymentResult {
  address: string
  deployTx?: string
}

export interface BridgeDeployment {
  Poseidon2?: DeploymentResult & { deployed: boolean }
  L2Gateway7683: DeploymentResult & { configTxs?: string[] }
  Forwarder: DeploymentResult & { configTx?: string }
  AztecGateway7683: DeploymentResult
}

export interface TokenDeployment {
  EVMToken?: DeploymentResult
  AztecToken?: DeploymentResult
}
