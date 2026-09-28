const MEMORY_RE = /<memory\b([^>]*)>([\s\S]*?)<\/memory>/gi
const PROFILE_RE = /<user-profile\b([^>]*)>([\s\S]*?)<\/user-profile>/gi
const ATTR_RE = /([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g

function attributes(source) {
  const result = {}
  for (const match of String(source || "").matchAll(ATTR_RE)) {
    result[match[1]] = match[2] ?? match[3] ?? ""
  }
  return result
}

function cleanBody(value) {
  return String(value || "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
}

function titleFor(uri, body, fallback = "OpenViking context") {
  const heading = String(body || "").match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const leaf = String(uri || "").split("/").filter(Boolean).at(-1)?.replace(/\.(md|txt|json)$/i, "")
  return leaf || fallback
}

function score(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseContextBlock(block) {
  const text = String(block || "")
  const entries = []
  for (const match of text.matchAll(MEMORY_RE)) {
    const attrs = attributes(match[1])
    const content = cleanBody(match[2])
    entries.push({
      kind: "recall",
      uri: attrs.uri || "",
      memoryType: attrs.type || "memory",
      detail: attrs.detail || "",
      score: score(attrs.score),
      title: titleFor(attrs.uri, content, "Recalled memory"),
      content,
    })
  }
  for (const match of text.matchAll(PROFILE_RE)) {
    const attrs = attributes(match[1])
    const content = cleanBody(match[2])
    entries.push({
      kind: "session-start",
      uri: attrs.uri || "",
      memoryType: "profile",
      detail: "session-start",
      score: undefined,
      title: titleFor(attrs.uri, content, "User profile"),
      content,
    })
  }
  return entries
}

function dedupeEntries(entries, maxEntries) {
  const byKey = new Map()
  for (const entry of entries) {
    const key = entry.uri || `${entry.kind}:${entry.title}:${entry.content.slice(0, 80)}`
    const previous = byKey.get(key)
    if (!previous || (entry.score ?? -1) > (previous.score ?? -1)) byKey.set(key, entry)
  }
  return [...byKey.values()].slice(0, maxEntries)
}

export function recallTurns(messages, options = {}) {
  const maxTurns = options.maxTurns ?? 20
  const maxEntriesPerTurn = options.maxEntriesPerTurn ?? 50
  const turns = []
  for (const message of messages || []) {
    if (message?.type !== "user") continue
    const context = message?.metadata?.openviking?.context
    if (!Array.isArray(context)) continue
    const entries = dedupeEntries(context.flatMap(parseContextBlock), maxEntriesPerTurn)
    if (!entries.length) continue
    turns.push({
      messageID: String(message.id || ""),
      created: Number(message.time?.created || 0),
      entries,
    })
  }
  return turns.slice(-maxTurns).reverse()
}

function operationContent(operation, kind) {
  if (kind === "add") return cleanBody(operation.after ?? operation.content ?? operation.value ?? "")
  if (kind === "update") return cleanBody(operation.after ?? operation.content ?? "")
  return cleanBody(operation.deleted_content ?? operation.before ?? operation.content ?? "")
}

export function parseMemoryDiff(value, archive = {}) {
  const document = typeof value === "string" ? JSON.parse(value) : value
  const operations = document?.operations || {}
  const result = []
  for (const [source, kind] of [["adds", "add"], ["updates", "update"], ["deletes", "delete"]]) {
    for (const operation of operations[source] || []) {
      const uri = String(operation?.uri || operation?.target_uri || "")
      const content = operationContent(operation || {}, kind)
      result.push({
        kind,
        uri,
        memoryType: String(operation?.memory_type || operation?.category || "memory"),
        title: titleFor(uri, content, `${kind} memory`),
        content,
        before: cleanBody(operation?.before ?? operation?.deleted_content ?? ""),
        archiveName: String(archive.name || ""),
        archiveUri: String(archive.uri || document?.archive_uri || ""),
        extractedAt: String(document?.extracted_at || archive.modTime || ""),
        traceId: String(document?.trace_id || ""),
      })
    }
  }
  return result
}

export function dedupeChanges(changes, limit = 100) {
  const seen = new Set()
  const result = []
  for (const change of changes || []) {
    const key = `${change.archiveUri}:${change.kind}:${change.uri}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(change)
    if (result.length >= limit) break
  }
  return result
}

export function truncate(value, length = 2000) {
  const text = String(value || "")
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 1))}…`
}
