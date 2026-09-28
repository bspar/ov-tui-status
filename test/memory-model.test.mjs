import test from "node:test"
import assert from "node:assert/strict"
import { dedupeChanges, parseContextBlock, parseMemoryDiff, recallTurns, truncate } from "../src/memory-model.mjs"

test("parses recalled memories and profile blocks", () => {
  const entries = parseContextBlock(`<openviking-context>
<memory uri="viking://user/u/memories/x.md" type="preferences" score="0.52" detail="abstract">
# Plugin UI
Expandable memories.
</memory>
</openviking-context>`)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0], {
    kind: "recall",
    uri: "viking://user/u/memories/x.md",
    memoryType: "preferences",
    detail: "abstract",
    score: 0.52,
    title: "Plugin UI",
    content: "# Plugin UI\nExpandable memories.",
  })

  const profile = parseContextBlock(`<openviking-context source="session-start"><user-profile uri="viking://user/u/profile.md"># User\nHello</user-profile></openviking-context>`)
  assert.equal(profile[0].kind, "session-start")
  assert.equal(profile[0].title, "User")
})

test("bounds turns and deduplicates repeated URIs", () => {
  const block = (score) => `<openviking-context><memory uri="viking://user/u/m.md" type="events" score="${score}" detail="full"># Memory\nBody</memory></openviking-context>`
  const messages = [
    { type: "user", id: "one", time: { created: 1 }, metadata: { openviking: { context: [block(0.4), block(0.8)] } } },
    { type: "assistant", id: "skip" },
    { type: "user", id: "two", time: { created: 2 }, metadata: { openviking: { context: [block(0.6)] } } },
  ]
  const turns = recallTurns(messages, { maxTurns: 1 })
  assert.equal(turns.length, 1)
  assert.equal(turns[0].messageID, "two")
  assert.equal(turns[0].entries.length, 1)
})

test("parses and bounds memory diffs", () => {
  const changes = parseMemoryDiff({
    extracted_at: "2026-01-01T00:00:00Z",
    trace_id: "trace",
    operations: {
      adds: [{ uri: "viking://user/u/a.md", memory_type: "events", after: "# Added\nA" }],
      updates: [{ uri: "viking://user/u/b.md", memory_type: "preferences", before: "old", after: "# Updated\nnew" }],
      deletes: [{ uri: "viking://user/u/c.md", deleted_content: "# Deleted\nold" }],
    },
  }, { name: "archive_002", uri: "viking://session/archive_002" })
  assert.deepEqual(changes.map((entry) => entry.kind), ["add", "update", "delete"])
  assert.equal(changes[0].title, "Added")
  assert.equal(changes[1].before, "old")
  assert.equal(dedupeChanges([...changes, changes[0]]).length, 3)
})

test("truncates bounded display content", () => {
  assert.equal(truncate("short", 10), "short")
  assert.equal(truncate("0123456789", 5), "0123…")
})
