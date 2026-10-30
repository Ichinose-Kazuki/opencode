import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client"
import { applySessionTabActivity, type SessionTabActivityState } from "../../src/context/session-tabs-activity"

function event<T extends OpenCodeEvent["type"]>(
  type: T,
  data: Extract<OpenCodeEvent, { type: T }>["data"],
): OpenCodeEvent {
  return {
    id: "evt_activity",
    created: 1,
    type,
    durable: { aggregateID: "session", seq: 1, version: 1 },
    data,
  } as OpenCodeEvent
}

function apply(state: SessionTabActivityState | undefined, next: OpenCodeEvent): SessionTabActivityState {
  const result = applySessionTabActivity(state, next)
  if (result === null || result === undefined) throw new Error("unexpected activity update")
  return result
}

test("keeps running until every called tool settles", () => {
  const called = (id: string) =>
    event("session.tool.called", {
      sessionID: "session",
      assistantMessageID: "msg",
      id,
      input: {},
      executed: true,
    })
  const success = (id: string) =>
    event("session.tool.success", {
      sessionID: "session",
      assistantMessageID: "msg",
      id,
      content: [{ type: "text", text: "ok" }],
      executed: true,
    })

  let state = apply(undefined, called("first"))
  expect(state.activity).toBe("running")
  state = apply(state, called("second"))
  expect(state.activity).toBe("running")
  state = apply(state, success("first"))
  expect(state.activity).toBe("running")
  state = apply(state, success("second"))
  expect(state.activity).toBe("waiting")
})
