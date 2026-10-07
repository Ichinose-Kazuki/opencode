/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { useClipboard } from "../../src/context/clipboard"
import { copyOnSelectRelease } from "../../src/util/selection"
import { TestTuiContexts } from "../fixture/tui-environment"

function GutterCopyOnSelectText() {
  const renderer = useRenderer()
  const clipboard = useClipboard()
  const toast = {
    show: () => {},
    error: () => {},
  }
  return (
    <box paddingLeft={3} onMouseUp={(event) => copyOnSelectRelease(event, renderer, toast, clipboard)}>
      <text>alpha beta gamma</text>
    </box>
  )
}

test("copy-on-select starts when the drag begins in the left gutter", async () => {
  const writes: string[] = []
  const app = await testRender(
    () => (
      <TestTuiContexts
        clipboard={{
          async read() {
            return undefined
          },
          async write(text) {
            writes.push(text)
          },
        }}
      >
        <GutterCopyOnSelectText />
      </TestTuiContexts>
    ),
    { width: 24, height: 2, clock: new ManualClock() },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("alpha"))

    // Columns 0..2 are the box's left padding; the text starts at column 3.
    await app.mockMouse.drag(1, 0, 9, 0)

    expect(app.renderer.getSelection()?.getSelectedText() ?? "").toContain("alpha")
    expect(writes.join("")).toContain("alpha")
  } finally {
    app.renderer.destroy()
  }
})
