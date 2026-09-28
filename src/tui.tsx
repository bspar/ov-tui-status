import { Plugin } from "@opencode/plugin/tui"
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import type { SessionMessageInfo } from "@opencode/client"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { recallTurns, truncate } from "./memory-model.mjs"
import { OpenVikingStatusClient } from "./openviking-client.mjs"

const PANEL_NAME = "openviking.memories"
const PAGE_SIZE = 12

type RecallEntry = ReturnType<typeof recallTurns>[number]["entries"][number] & {
  group: string
  created: number
}

type ChangeEntry = {
  kind: "add" | "update" | "delete"
  uri: string
  memoryType: string
  title: string
  content: string
  before: string
  archiveName: string
  archiveUri: string
  extractedAt: string
  traceId: string
}

type DisplayEntry = (RecallEntry | ChangeEntry) & { displayKind: string }

function recalled(messages: SessionMessageInfo[]): RecallEntry[] {
  return recallTurns(messages, { maxTurns: 20, maxEntriesPerTurn: 50 }).flatMap((turn, index) =>
    turn.entries.map((entry) => ({
      ...entry,
      group: index === 0 ? "latest turn" : `turn ${turn.messageID.slice(-8)}`,
      created: turn.created,
    })),
  )
}

function latestRecallCount(messages: SessionMessageInfo[]) {
  return recallTurns(messages, { maxTurns: 1, maxEntriesPerTurn: 50 })[0]?.entries
    .filter((entry) => entry.kind === "recall").length ?? 0
}

function counts(changes: ChangeEntry[]) {
  return changes.reduce(
    (result, change) => {
      result[change.kind]++
      return result
    },
    { add: 0, update: 0, delete: 0 },
  )
}

function ComposerStatus(props: { context: Context; sessionID: string; client: OpenVikingStatusClient }) {
  const [changes, setChanges] = createSignal<ChangeEntry[]>([])
  const messages = () => props.context.data.session.message.list(props.sessionID)
  const recallCount = createMemo(() => latestRecallCount(messages()))
  const changeCounts = createMemo(() => counts(changes()))

  onMount(() => {
    void props.client.sessionChanges(props.sessionID)
      .then((result) => setChanges(result.changes as ChangeEntry[]))
      .catch(() => undefined)
  })

  const summary = createMemo(() => {
    const parts = [`OpenViking: recalled ${recallCount()}`]
    const current = changeCounts()
    if (current.add) parts.push(`+${current.add} created`)
    if (current.update) parts.push(`~${current.update} updated`)
    if (current.delete) parts.push(`-${current.delete} deleted`)
    return `▸ ${parts.join(" · ")}  (/ov-memories)`
  })

  return <text fg={props.context.theme.text.muted}>{summary()}</text>
}

function MemoryPanel(props: { context: Context; panel: PanelInput; client: OpenVikingStatusClient }) {
  const [tab, setTab] = createSignal<"recall" | "changes">("recall")
  const [changes, setChanges] = createSignal<ChangeEntry[]>([])
  const [status, setStatus] = createSignal("loading")
  const [selected, setSelected] = createSignal(0)
  const [offset, setOffset] = createSignal(0)
  const [expanded, setExpanded] = createSignal(false)

  const messages = () => props.context.data.session.message.list(props.panel.sessionID)
  const recallEntries = createMemo(() => recalled(messages()))
  const entries = createMemo<DisplayEntry[]>(() => {
    if (tab() === "recall") {
      return recallEntries().map((entry) => ({ ...entry, displayKind: entry.kind === "session-start" ? "profile" : "recall" }))
    }
    return changes().map((entry) => ({ ...entry, displayKind: entry.kind }))
  })
  const visible = createMemo(() => entries().slice(offset(), offset() + PAGE_SIZE))
  const current = createMemo(() => entries()[selected()])

  async function refresh(force = false) {
    setStatus("loading")
    try {
      await props.context.data.session.message.sync(props.panel.sessionID)
      const result = await props.client.sessionChanges(props.panel.sessionID, { force })
      setChanges(result.changes as ChangeEntry[])
      setStatus(result.status)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "unavailable")
    }
  }

  function selectTab(next: "recall" | "changes") {
    setTab(next)
    setSelected(0)
    setOffset(0)
    setExpanded(false)
  }

  function move(delta: number) {
    const maximum = Math.max(0, entries().length - 1)
    const next = Math.max(0, Math.min(maximum, selected() + delta))
    setSelected(next)
    setExpanded(false)
    if (next < offset()) setOffset(next)
    else if (next >= offset() + PAGE_SIZE) setOffset(next - PAGE_SIZE + 1)
  }

  props.context.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    enabled: props.panel.focused,
    commands: [
      { id: "ov.memories.down", bind: "j", run: () => move(1) },
      { id: "ov.memories.down.arrow", bind: "down", run: () => move(1) },
      { id: "ov.memories.up", bind: "k", run: () => move(-1) },
      { id: "ov.memories.up.arrow", bind: "up", run: () => move(-1) },
      { id: "ov.memories.expand", bind: "return", run: () => setExpanded((value) => !value) },
      { id: "ov.memories.tab", bind: "tab", run: () => selectTab(tab() === "recall" ? "changes" : "recall") },
      { id: "ov.memories.refresh", bind: "r", run: () => refresh(true) },
      { id: "ov.memories.fullscreen", bind: "f", run: props.panel.toggleFullscreen },
      { id: "ov.memories.close", bind: "escape", run: props.panel.close },
    ],
  }))

  onMount(() => void refresh())

  const countLabel = createMemo(() => {
    if (tab() === "recall") return `${entries().length} recalled entries from the latest 20 turns`
    return `${entries().length} changes from the latest 20 archives · ${status()}`
  })

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={props.context.theme.text.base}><b>OpenViking memories</b></text>
      <text fg={props.context.theme.text.muted}>
        {tab() === "recall" ? "[Recalled]  Created / Updated" : " Recalled  [Created / Updated]"}
        {"  ·  Tab switch · j/k move · Enter expand · r refresh · f fullscreen · Esc close"}
      </text>
      <text fg={props.context.theme.text.muted}>{countLabel()}</text>
      <text> </text>
      <Show when={entries().length > 0} fallback={<text fg={props.context.theme.text.muted}>(no entries)</text>}>
        <For each={visible()}>{(entry, index) => {
          const absolute = () => offset() + index()
          const active = () => absolute() === selected()
          const score = () => "score" in entry && entry.score !== undefined ? ` ${(entry.score as number).toFixed(2)}` : ""
          return (
            <text fg={active() ? props.context.theme.text.base : props.context.theme.text.muted}>
              {active() ? "›" : " "} {entry.title}  · {entry.displayKind}{score()}
            </text>
          )
        }}</For>
      </Show>
      <Show when={expanded() && current()}>
        {(selectedEntry) => (
          <box flexDirection="column" marginTop={1} borderStyle="single" borderColor={props.context.theme.border.base} padding={1}>
            <text fg={props.context.theme.text.base}><b>{selectedEntry().title}</b></text>
            <text fg={props.context.theme.text.muted}>{selectedEntry().uri || "(no URI)"}</text>
            <text fg={props.context.theme.text.muted}>
              {selectedEntry().displayKind} · {selectedEntry().memoryType}
              {"detail" in selectedEntry() && selectedEntry().detail ? ` · ${selectedEntry().detail}` : ""}
              {"archiveName" in selectedEntry() && selectedEntry().archiveName ? ` · ${selectedEntry().archiveName}` : ""}
            </text>
            <text> </text>
            <text fg={props.context.theme.text.base}>{truncate(selectedEntry().content, 2000) || "(no body recorded)"}</text>
          </box>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "openviking.tui-status",
  setup(context) {
    const client = new OpenVikingStatusClient(context.options || {})

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "openviking.memories",
          title: "Open OpenViking memories",
          description: "Inspect recalled and extracted memories for this session",
          group: "OpenViking",
          palette: true,
          slash: { name: "ov-memories", aliases: ["memories"] },
          suggested: true,
          run: () => {
            if (!context.ui.panel.open(PANEL_NAME)) {
              context.ui.toast.show({ message: "Open an OpenCode session first", variant: "warning" })
            }
          },
        },
      ],
    }))

    const unregisterComposer = context.ui.slot({
      append: "session.composer.top",
      render: ({ sessionID }) => <ComposerStatus context={context} sessionID={sessionID} client={client} />,
    })
    const unregisterPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL_NAME}>
          <MemoryPanel context={context} panel={panel} client={client} />
        </Show>
      ),
    })

    return () => {
      unregisterComposer()
      unregisterPanel()
    }
  },
})
