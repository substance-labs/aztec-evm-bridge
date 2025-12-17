import { defineConfig, configDefaults } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      exclude: [...(configDefaults.coverage.exclude || []), "src/abis/**", "src/artifacts/**"],
    },
  },
})
