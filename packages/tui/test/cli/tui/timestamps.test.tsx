/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { SessionInboxInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import type { SessionEntry, SessionNode } from "../../../src/routes/session/grouping/session"
import { entryTime, latestGroupTime, TimestampLine } from "../../../src/routes/session/timestamps"
import { emptyThemeSource } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const message = (input: {
  id: string
  created: number
  completed?: number
  content?: SessionMessageAssistant["content"]
  retryAt?: number
}): SessionMessageInfo =>
  input.content === undefined
    ? { id: input.id, type: "user", text: input.id, time: { created: input.created } }
    : ({
        id: input.id,
        type: "assistant",
        agent: "build",
        model: { providerID: "provider", id: "model" },
        time: { created: input.created, completed: input.completed },
        content: input.content,
        ...(input.retryAt === undefined
          ? {}
          : {
              retry: {
                attempt: 1,
                at: input.retryAt,
                error: { type: "provider", message: "retry" },
              },
            }),
      } satisfies SessionMessageAssistant)

const lookup =
  (...messages: SessionMessageInfo[]) =>
  (id: string) =>
    messages.find((item) => item.id === id)

const part = (partID: string): SessionEntry => ({
  type: "part",
  ref: { messageID: "assistant", partID },
})

const group = (
  children: Extract<SessionNode, { type: "group" }>["children"],
): Extract<SessionNode, { type: "group" }> => ({
  type: "group",
  kind: "exploration",
  size: children.length,
  children,
})

test("reads an entry's timestamp from the message or part that owns it", () => {
  const assistant = message({
    id: "assistant",
    created: 1_000,
    completed: 2_000,
    content: [
      { type: "text", text: "hello", time: { created: 1_100, completed: 1_200 } },
      { type: "reasoning", text: "thinking", time: { created: 1_300, completed: 1_400 } },
      {
        type: "tool",
        id: "tool-1",
        name: "read",
        time: { created: 1_500, completed: 1_600 },
        state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] },
      },
    ],
  })
  const user = message({ id: "user", created: 900 })
  const resolve = lookup(assistant, user)
  const pending = [{ id: "inbox", time: { created: 1_700 } }] as unknown as SessionInboxInfo[]

  expect(entryTime({ type: "message", messageID: "user" }, resolve)).toBe(900)
  expect(entryTime(part("text:0"), resolve)).toBe(1_100)
  expect(entryTime(part("reasoning:0"), resolve)).toBe(1_300)
  expect(entryTime(part("tool-1"), resolve)).toBe(1_500)
  expect(entryTime({ type: "assistant-footer", messageID: "assistant" }, resolve)).toBe(2_000)
  expect(entryTime({ type: "compaction-queued", inboxID: "inbox" }, resolve, pending)).toBe(1_700)
  expect(entryTime({ type: "turn-usage", messageIDs: ["assistant"] }, resolve)).toBeUndefined()
})

test("omits timestamps that the data does not carry", () => {
  const assistant = message({
    id: "assistant",
    created: 1_000,
    content: [
      { type: "text", text: "old text" },
      { type: "reasoning", text: "old thought" },
    ],
  })
  const resolve = lookup(assistant)

  expect(entryTime(part("text:0"), resolve)).toBeUndefined()
  expect(entryTime(part("reasoning:0"), resolve)).toBeUndefined()
  expect(entryTime({ type: "assistant-footer", messageID: "assistant" }, resolve)).toBeUndefined()
})

test("uses the newest timestamp among a group's children", () => {
  const assistant = message({
    id: "assistant",
    created: 1_000,
    content: [
      { type: "text", text: "first", time: { created: 1_100 } },
      { type: "text", text: "second", time: { created: 1_900 } },
    ],
  })
  const resolve = lookup(assistant)
  const node = group([
    { type: "entry", size: 1, entry: part("text:0") },
    { type: "entry", size: 1, entry: part("text:1") },
  ])

  expect(latestGroupTime(node, resolve)).toBe(1_900)

  const untimed = message({
    id: "assistant",
    created: 1_000,
    content: [{ type: "text", text: "old text" }],
  })
  expect(latestGroupTime(group([{ type: "entry", size: 1, entry: part("text:0") }]), lookup(untimed))).toBeUndefined()
})

test("renders a timestamp below the transcript indent", async () => {
  const time = new Date(2026, 10, 4, 23, 29).getTime()
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <TimestampLine time={time} />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 30, height: 2 },
  )
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("11-04 23:29")
    expect(app.captureCharFrame().split("\n")[0]?.startsWith("   11-04 23:29")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
