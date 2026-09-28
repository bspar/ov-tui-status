import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenVikingStatusClient } from "../src/openviking-client.mjs"

test("loads bounded archive diffs for a mapped OpenCode session", async () => {
  const root = await mkdtemp(join(tmpdir(), "ov-tui-status-"))
  const configPath = join(root, "ovcli.conf")
  const statePath = join(root, "state.json")
  await writeFile(configPath, JSON.stringify({ url: "http://ov.test", account: "default", user: "user" }))
  await writeFile(statePath, JSON.stringify({ sessions: { ses_test: { ovSessionId: "oc-test" } } }))

  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), headers: options.headers })
    const parsed = new URL(url)
    let result
    if (parsed.pathname === "/api/v1/sessions/oc-test") {
      result = { uri: "viking://user/user/sessions/oc-test", commit_count: 2, pending_tokens: 10 }
    } else if (parsed.pathname === "/api/v1/fs/ls") {
      result = [
        { name: "archive_001", uri: "viking://s/archive_001", isDir: true },
        { name: "archive_002", uri: "viking://s/archive_002", isDir: true },
      ]
    } else if (parsed.searchParams.get("uri")?.includes("archive_002")) {
      result = { content: JSON.stringify({ operations: { adds: [{ uri: "viking://user/user/memories/new.md", after: "# New" }], updates: [], deletes: [] } }) }
    } else {
      result = { content: JSON.stringify({ operations: { adds: [], updates: [], deletes: [] } }) }
    }
    return new Response(JSON.stringify({ status: "ok", result }), { status: 200, headers: { "content-type": "application/json" } })
  }

  const client = new OpenVikingStatusClient({ configPath, statePath, fetchImpl, cacheTtlMs: 60000 })
  const result = await client.sessionChanges("ses_test")
  assert.equal(result.status, "ready")
  assert.equal(result.archives, 2)
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].kind, "add")
  assert.equal(requests[0].headers["X-OpenViking-User"], "user")

  await client.sessionChanges("ses_test")
  assert.equal(requests.length, 4, "second call uses the bounded cache")
})

test("falls back to the conventional OpenViking session id and reports a missing session", async () => {
  const root = await mkdtemp(join(tmpdir(), "ov-tui-status-"))
  const configPath = join(root, "ovcli.conf")
  const statePath = join(root, "state.json")
  await writeFile(configPath, JSON.stringify({ url: "http://ov.test" }))
  await writeFile(statePath, JSON.stringify({ sessions: {} }))
  let requested = ""
  const client = new OpenVikingStatusClient({
    configPath,
    statePath,
    fetchImpl: async (url) => {
      requested = String(url)
      return new Response(JSON.stringify({ status: "error", error: { message: "not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    },
  })
  const result = await client.sessionChanges("missing")
  assert.equal(result.status, "unmapped")
  assert.match(requested, /\/sessions\/oc-missing$/)
})
