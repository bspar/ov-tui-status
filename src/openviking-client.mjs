import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { dedupeChanges, parseMemoryDiff } from "./memory-model.mjs"

function expandHome(path) {
  return String(path || "").replace(/^~(?=\/|$)/, homedir())
}

async function readJSON(path) {
  return JSON.parse(await readFile(expandHome(path), "utf8"))
}

function normalizeConfig(raw) {
  return {
    url: String(raw?.url || "http://127.0.0.1:1933").replace(/\/$/, ""),
    apiKey: String(raw?.api_key || ""),
    account: String(raw?.account || ""),
    user: String(raw?.user || ""),
  }
}

export class OpenVikingStatusClient {
  constructor(options = {}) {
    this.configPath = options.configPath || process.env.OPENVIKING_CLI_CONFIG_FILE || join(homedir(), ".openviking", "ovcli.conf")
    this.statePath = options.statePath || join(homedir(), ".config", "opencode", "openviking", "openviking-session-state.json")
    this.fetch = options.fetchImpl || globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 3000
    this.maxArchives = options.maxArchives ?? 20
    this.maxChanges = options.maxChanges ?? 100
    this.cacheTtlMs = options.cacheTtlMs ?? 15000
    this.cache = new Map()
  }

  invalidate(sessionID) {
    if (sessionID) this.cache.delete(sessionID)
    else this.cache.clear()
  }

  async sessionChanges(sessionID, options = {}) {
    const cached = this.cache.get(sessionID)
    if (!options.force && cached && Date.now() - cached.time < this.cacheTtlMs) return cached.value
    const value = await this.#loadSessionChanges(sessionID)
    this.cache.set(sessionID, { time: Date.now(), value })
    return value
  }

  async #loadSessionChanges(sessionID) {
    const [rawConfig, state] = await Promise.all([readJSON(this.configPath), readJSON(this.statePath)])
    const config = normalizeConfig(rawConfig)
    const ovSessionID = state?.sessions?.[sessionID]?.ovSessionId
    if (!ovSessionID) return { status: "unmapped", ovSessionID: "", changes: [], archives: 0 }

    const session = await this.#request(config, `/api/v1/sessions/${encodeURIComponent(ovSessionID)}`)
    const sessionUri = String(session?.uri || "")
    if (!sessionUri) return { status: "unavailable", ovSessionID, changes: [], archives: 0 }

    const historyUri = `${sessionUri}/history`
    const listed = await this.#request(config, "/api/v1/fs/ls", {
      uri: historyUri,
      output: "original",
      recursive: "false",
    })
    const archives = (Array.isArray(listed) ? listed : [])
      .filter((entry) => entry?.isDir && /^archive_\d+$/.test(String(entry.name || "")))
      .sort((a, b) => String(b.name).localeCompare(String(a.name)))
      .slice(0, this.maxArchives)

    const changes = []
    for (const archive of archives) {
      try {
        const diff = await this.#request(config, "/api/v1/content/read", {
          uri: `${archive.uri}/memory_diff.json`,
        })
        const content = typeof diff === "string" ? diff : diff?.content ?? diff
        changes.push(...parseMemoryDiff(content, archive))
      } catch (error) {
        if (error?.status !== 404) throw error
      }
    }
    return {
      status: "ready",
      ovSessionID,
      changes: dedupeChanges(changes, this.maxChanges),
      archives: archives.length,
      commitCount: Number(session?.commit_count || 0),
      pendingTokens: Number(session?.pending_tokens || 0),
    }
  }

  async #request(config, path, query) {
    const url = new URL(config.url + path)
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value))
    const headers = { Accept: "application/json" }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    else {
      if (config.account) headers["X-OpenViking-Account"] = config.account
      if (config.user) headers["X-OpenViking-User"] = config.user
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetch(url, { headers, signal: controller.signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.status === "error") {
        const error = new Error(payload?.error?.message || `OpenViking request failed: ${response.status}`)
        error.status = response.status
        throw error
      }
      return payload?.result ?? payload
    } finally {
      clearTimeout(timer)
    }
  }
}
