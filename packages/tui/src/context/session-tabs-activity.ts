import type { OpenCodeEvent } from "@opencode/client"

export type SessionTabActivity =
  | "queued"
  | "waiting"
  | "thinking"
  | "writing"
  | "preparing"
  | "running"
  | "retrying"
  | "compacting"

export type SessionTabActivityState = {
  activity: SessionTabActivity
  // A step can call several tools at once, so running lasts until every call settles.
  tools: Record<string, true>
}

const state = (activity: SessionTabActivity, tools: Record<string, true> = {}): SessionTabActivityState => ({
  activity,
  tools,
})

const withTool = (tools: Record<string, true>, id: string): Record<string, true> => ({ ...tools, [id]: true })

const withoutTool = (tools: Record<string, true>, id: string) => {
  const next = { ...tools }
  delete next[id]
  return next
}

// Returns null to clear the session's activity, or undefined when the event leaves it unchanged.
export function applySessionTabActivity(
  current: SessionTabActivityState | undefined,
  event: OpenCodeEvent,
): SessionTabActivityState | null | undefined {
  switch (event.type) {
    case "session.execution.started":
    case "session.step.started":
      return state("waiting")
    case "session.reasoning.started":
      return state("thinking", current?.tools)
    case "session.text.started":
      return state("writing", current?.tools)
    case "session.tool.input.started":
      return state("preparing", current?.tools)
    case "session.tool.called":
      return state("running", withTool(current?.tools ?? {}, event.data.id))
    case "session.tool.success":
    case "session.tool.failed": {
      const tools = withoutTool(current?.tools ?? {}, event.data.id)
      return state(Object.keys(tools).length > 0 ? "running" : "waiting", tools)
    }
    case "session.retry.scheduled":
      return state("retrying")
    case "session.compaction.started":
      return state("compacting")
    case "session.compaction.ended":
    case "session.compaction.failed":
      return state("waiting")
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.deleted":
      return null
    case "session.inbox.enqueued":
      // A prompt queued behind running work leaves the current activity in place.
      if (event.data.item.type !== "user" || current) return undefined
      return state("queued")
    default:
      return undefined
  }
}
