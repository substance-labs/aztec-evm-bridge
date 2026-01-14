import "dotenv/config"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "test/**/browser/**"],
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
    conditions: ["node", "import"],
  },
})
