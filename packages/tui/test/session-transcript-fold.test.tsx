import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("ctrl+o folds and unfolds transcript details without changing the config", async () => {
  const session = {
    id: "ses_fold",
    title: "Fold",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const model = { providerID: "fixture", id: "fixture" }
  const messages: SessionMessageInfo[] = [
    { type: "user", id: "user-fold", text: "Write a file", time: { created: 0 } },
    {
      type: "assistant",
      id: "assistant-fold",
      agent: "build",
      model,
      finish: "stop",
      time: { created: 1, completed: 2 },
      content: [
        { type: "text", text: "Writing the note." },
        {
          type: "tool",
          id: "write-fold",
          name: "write",
          time: { created: 1, completed: 2 },
          state: {
            status: "completed",
            input: { path: "folded-notes.txt", content: "note" },
            content: [{ type: "text", text: "ok" }],
            metadata: {},
          },
        },
      ],
    },
  ]

  await using app = await createAppFixture({
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    },
  })

  await app.ready
  await app.waitForFrame((frame) => frame.includes("folded-notes.txt"))

  await app.mockInput.pressKey("o", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("1 edit"))
  expect(app.captureCharFrame()).not.toContain("folded-notes.txt")

  await app.mockInput.pressKey("o", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("folded-notes.txt"))
  expect(app.config().session?.verbosity).toBeUndefined()
})
