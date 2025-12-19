import { describe, it, expect } from "vitest"
import { hexToUintArray } from "../../src/utils/bytes.js"

describe("bytes utils", () => {
  describe("hexToUintArray", () => {
    it("should convert hex string to number array", () => {
      const hex = "0x010203"
      const result = hexToUintArray(hex)
      expect(result).toEqual([1, 2, 3])
    })

    it("should handle empty hex string", () => {
      const hex = "0x"
      const result = hexToUintArray(hex)
      expect(result).toEqual([])
    })
  })
})
