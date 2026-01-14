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
  // Explicitly access known env vars to allow bundler replacement
  // This is necessary because 'define' in Vite replaces the expression, not the property on the object
  const explicitEnv: BrowserTestEnv = {
    EVM_PK: process.env.EVM_PK,
    EVM_ADDRESS: process.env.EVM_ADDRESS,
    AZTEC_SECRET_KEY: process.env.AZTEC_SECRET_KEY,
    AZTEC_KEY_SALT: process.env.AZTEC_KEY_SALT,
    BROWSER_E2E: process.env.BROWSER_E2E,
    AZTEC_NODE_URL: process.env.AZTEC_NODE_URL,
  }

  // Filter out undefined values
  Object.keys(explicitEnv).forEach((key) => {
    if (explicitEnv[key as BrowserEnvKeys] === undefined) {
      delete explicitEnv[key as BrowserEnvKeys]
    }
  })

  return {
    ...browserTestEnv,
    ...explicitEnv,
  }
}
