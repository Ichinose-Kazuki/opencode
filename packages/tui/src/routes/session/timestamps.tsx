import { createMemo, Show, type JSX } from "solid-js"
import type { SessionInboxInfo, SessionMessageInfo } from "@opencode/client"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { visitEntries } from "./anchor-view"
import type { SessionEntry, SessionNode } from "./grouping/session"
import { resolvePart } from "./rows"

const TIMESTAMP_INDENT = 3

type MessageLookup = (messageID: string) => SessionMessageInfo | undefined

export function entryTime(
  entry: SessionEntry,
  message: MessageLookup,
  pending: readonly SessionInboxInfo[] = [],
): number | undefined {
  if (entry.type === "message") return message(entry.messageID)?.time.created
  if (entry.type === "compaction-queued") return pending.find((item) => item.id === entry.inboxID)?.time.created
  if (entry.type === "assistant-footer") {
    const item = message(entry.messageID)
    return item?.type === "assistant" ? (item.time.completed ?? item.retry?.at) : undefined
  }
  if (entry.type === "turn-usage") return undefined
  const item = message(entry.ref.messageID)
  if (item?.type !== "assistant") return undefined
  const part = resolvePart(item, entry.ref.partID)
  if (part?.type === "text" || part?.type === "reasoning") return part.time?.created
  if (part?.type === "tool") return part.time.created
  return undefined
}

export function latestGroupTime(
  node: Extract<SessionNode, { type: "group" }>,
  message: MessageLookup,
  pending: readonly SessionInboxInfo[] = [],
): number | undefined {
  const entries: SessionEntry[] = []
  visitEntries(node.children, (entry) => entries.push(entry))
  for (let index = entries.length - 1; index >= 0; index--) {
    const time = entryTime(entries[index], message, pending)
    if (time !== undefined) return time
  }
  return undefined
}

export function TimestampLine(props: { time: number; paddingLeft?: number }) {
  const theme = useTheme()
  return (
    <box paddingLeft={props.paddingLeft ?? TIMESTAMP_INDENT} flexShrink={0}>
      <text fg={theme.text.muted}>{Locale.timestamp(props.time)}</text>
    </box>
  )
}

export function TimestampLineIf(props: { time: number | undefined; paddingLeft?: number }) {
  return (
    <Show when={props.time !== undefined}>
      <TimestampLine time={props.time!} paddingLeft={props.paddingLeft} />
    </Show>
  )
}

export function Timestamped(props: { time: number | undefined; children: JSX.Element; paddingLeft?: number }) {
  return (
    <>
      {props.children}
      <TimestampLineIf time={props.time} paddingLeft={props.paddingLeft} />
    </>
  )
}

export function GroupTimestamp(props: {
  node: Extract<SessionNode, { type: "group" }>
  message: MessageLookup
  paddingLeft?: number
}) {
  const time = createMemo(() => latestGroupTime(props.node, props.message))
  return <TimestampLineIf time={time()} paddingLeft={props.paddingLeft} />
}
