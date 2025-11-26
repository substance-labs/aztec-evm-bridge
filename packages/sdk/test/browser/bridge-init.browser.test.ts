import { describe, expect, it } from "vitest"

import { Bridge } from "../../src"
import type { Hex } from "viem"

const hex = (value: string) => ("0x" + value.padStart(64, "0").slice(-64)) as Hex

const SAMPLE_PRIVATE_KEY = hex("1")

const minimalConfigs = () => ({
  evmPrivateKey: SAMPLE_PRIVATE_KEY,
})

describe("Bridge initialization (browser)", () => {
  it("requires aztecWallet or azguardClient", async () => {
    await expect(Bridge.create(minimalConfigs())).rejects.toThrow("You must specify aztecWallet or azguardClient")
  })

  it("prevents specifying both evmPrivateKey and evmProvider", async () => {
    // Note: This test requires a mock wallet, which would be too complex for this simple test
    // The actual validation happens in the Bridge constructor
    await expect(
      Bridge.create({
        ...minimalConfigs(),
        azguardClient: {} as never,
        evmProvider: {},
      }),
    ).rejects.toThrow("Cannot specify both evmPrivateKey and evmProvider")
  })

  it("prevents mixing azguard client with wallet", async () => {
    await expect(
      Bridge.create({
        ...minimalConfigs(),
        aztecWallet: {} as never,
        azguardClient: {} as never,
      }),
    ).rejects.toThrow("Cannot specify both azguardClient and aztecWallet")
  })
})
