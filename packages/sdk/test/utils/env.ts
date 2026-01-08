type BrowserEnvKeys =
  | "BROWSER_E2E"
  | "AZTEC_NODE_URL"
  | "EVM_PK"
  | "EVM_ADDRESS"
  | "AZTEC_SECRET_KEY"
  | "AZTEC_KEY_SALT"

type BrowserTestEnv = Partial<Record<BrowserEnvKeys, string>>

type ImportMetaWithEnv = ImportMeta & { env?: Record<string, string> }

function readEnv(): BrowserTestEnv {
  if (typeof import.meta !== "undefined") {
    const env = (import.meta as ImportMetaWithEnv).env
    if (env) {
      return env as BrowserTestEnv
    }
  }

  if (typeof process !== "undefined" && process.env) {
    return process.env as BrowserTestEnv
  }

  return {}
}

const browserTestEnv = readEnv()

export function getBrowserTestEnv(): BrowserTestEnv {
  return browserTestEnv
}
