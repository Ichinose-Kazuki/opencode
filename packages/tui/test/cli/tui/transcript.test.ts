import { describe, expect, test } from "bun:test"
import { nextVerbosityOverride } from "../../../src/context/transcript"

describe("nextVerbosityOverride", () => {
  test("folds from every detailed level", () => {
    expect(nextVerbosityOverride("medium", "medium")).toBe("low")
    expect(nextVerbosityOverride("high", "high")).toBe("low")
  })

  test("restores the configured level when leaving low", () => {
    expect(nextVerbosityOverride("low", "medium")).toBeUndefined()
    expect(nextVerbosityOverride("low", "high")).toBeUndefined()
  })

  test("unfolds to medium when low is the configured level", () => {
    expect(nextVerbosityOverride("low", "low")).toBe("medium")
  })
})
