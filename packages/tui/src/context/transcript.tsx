import { createEffect, createMemo, createSignal, on } from "solid-js"
import { useConfig } from "../config"
import { defaultVerbosity, type Verbosity } from "../routes/session/grouping/session"
import { createSimpleContext } from "./helper"

/**
 * Next transient verbosity override for the fold shortcut. Leaving low returns to the
 * configured level, or to medium when low is also the configured level.
 */
export function nextVerbosityOverride(current: Verbosity, configured: Verbosity): Verbosity | undefined {
  if (current !== "low") return "low"
  return configured === "low" ? "medium" : undefined
}

export const { use: useTranscript, provider: TranscriptProvider } = createSimpleContext({
  name: "Transcript",
  init: () => {
    const config = useConfig()
    const [override, setOverride] = createSignal<Verbosity>()
    const configured = () => config.data.session?.verbosity ?? defaultVerbosity
    const verbosity = createMemo(() => override() ?? configured())

    // Changing the configured level from settings or the cycle command must visibly apply.
    createEffect(on(configured, () => setOverride(undefined), { defer: true }))

    return {
      verbosity,
      folded: () => verbosity() === "low",
      toggleFold() {
        setOverride(nextVerbosityOverride(verbosity(), configured()))
      },
      clear() {
        setOverride(undefined)
      },
    }
  },
})
