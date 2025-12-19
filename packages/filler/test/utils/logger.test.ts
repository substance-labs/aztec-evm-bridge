import { describe, it, expect } from "vitest"
import logger from "../../src/utils/logger.js"

describe("logger utils", () => {
  it("should export a winston logger", () => {
    expect(logger).toBeDefined()
    expect(logger.info).toBeDefined()
    expect(logger.error).toBeDefined()
    expect(logger.warn).toBeDefined()
    expect(logger.debug).toBeDefined()

    // Trigger the format function
    logger.info("test message", { service: "test-service" })

    // Trigger the format function without service
    logger.info("test message without service")
  })
})
