import "dotenv/config"
import { defineConfig } from "vitest/config"
import { playwright } from "@vitest/browser-playwright"
import react from "@vitejs/plugin-react"
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"
import { nodePolyfills } from "vite-plugin-node-polyfills"
/* eslint-disable @typescript-eslint/no-unused-vars */
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { createRequire } from "node:module"

const headless = process.env.BROWSER_HEADLESS !== undefined ? process.env.BROWSER_HEADLESS === "true" : true

const pkgDir = dirname(fileURLToPath(import.meta.url))

const envPrefixes = ["VITE_", "BROWSER_", "AZTEC_", "EVM_"]

const require = createRequire(import.meta.url)

const blockchainAliases = {
  crypto: require.resolve("crypto-browserify"),
  stream: require.resolve("stream-browserify"),
  util: require.resolve("util/"),
  path: require.resolve("path-browserify"),
  pino: require.resolve("pino/browser.js"),
  "hash.js": require.resolve("hash.js/lib/hash.js"),
  sha3: require.resolve("sha3/index.js"),
  "lodash.chunk": require.resolve("lodash.chunk/index.js"),
  "lodash.times": require.resolve("lodash.times/index.js"),
  "lodash.isequal": require.resolve("lodash.isequal/index.js"),
  "json-stringify-deterministic": require.resolve("json-stringify-deterministic/lib/index.js"),
}

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      include: ["buffer", "crypto", "util", "assert", "process", "stream", "path", "url", "events"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  assetsInclude: ["**/*.wasm"],
  envPrefix: envPrefixes,
  define: {
    global: "globalThis",
    "import.meta.env.EVM_PK": JSON.stringify(process.env.EVM_PK),
    "import.meta.env.AZTEC_SECRET_KEY": JSON.stringify(process.env.AZTEC_SECRET_KEY),
    "import.meta.env.AZTEC_KEY_SALT": JSON.stringify(process.env.AZTEC_KEY_SALT),
    "import.meta.env.BROWSER_E2E": JSON.stringify(process.env.BROWSER_E2E),
    "process.env.EVM_PK": JSON.stringify(process.env.EVM_PK),
    "process.env.AZTEC_SECRET_KEY": JSON.stringify(process.env.AZTEC_SECRET_KEY),
    "process.env.AZTEC_KEY_SALT": JSON.stringify(process.env.AZTEC_KEY_SALT),
    "process.env.BROWSER_E2E": JSON.stringify(process.env.BROWSER_E2E),
  },
  worker: {
    format: "es",
  },
  server: {
    port: 3000,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
    fs: {
      allow: [".."],
    },
  },
  test: {
    globals: true,
    include: ["test/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless,
      instances: [
        {
          browser: "chromium",
        },
      ],
    },
    bail: 1,
    coverage: {
      reporter: ["text", "json", "html"],
    },
    testTimeout: 15 * 60 * 1000,
  },
  ssr: {
    noExternal: [/@aztec/],
  },
  resolve: {
    alias: {
      ...blockchainAliases,
    },
    conditions: ["browser", "import"],
  },
  optimizeDeps: {
    include: [
      "buffer",
      "crypto-browserify",
      "stream-browserify",
      "util",
      "path-browserify",
      "path",
      "vite-plugin-node-polyfills/shims/buffer",
      "vite-plugin-node-polyfills/shims/global",
      "vite-plugin-node-polyfills/shims/process",
      "hash.js",
      "sha3",
      "pino",
      "json-stringify-deterministic",
      "assert",
      "lodash.times",
      "lodash.chunk",
      "lodash.isequal",
      "viem",
    ],
    exclude: [
      "@aztec/bb.js",
      "@aztec/pxe",
      "@aztec/pxe/client/lazy",
      "@aztec/foundation",
      "@aztec/aztec.js",
      "@aztec/circuits.js",
      "@aztec/noir-contracts.js",
      "@defi-wonderland/aztec-standards",
      "noirc_abi_wasm",
      "@substancelabs/aztec-evm-bridge-sdk",
    ],
  },
  build: {
    sourcemap: false,
    minify: "esbuild",
    chunkSizeWarningLimit: 2000,
    commonjsOptions: {
      defaultIsModuleExports: (id: string) => {
        if (id.includes("@aztec/")) {
          return false
        }
        return "auto"
      },
    },
    rollupOptions: {
      output: {
        format: "es",
        preserveModules: false,
        inlineDynamicImports: false,
        interop: "auto",
        assetFileNames: (assetInfo) => {
          if ((assetInfo as { name?: string }).name?.endsWith(".wasm")) {
            return "assets/[name]-[hash][extname]"
          }
          return "assets/[name]-[hash][extname]"
        },
      },
    },
  },
})
