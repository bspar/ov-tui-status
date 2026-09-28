# ov-tui-status

A bounded, read-only OpenCode TUI companion for the OpenViking OpenCode memory
plugin. It makes hidden prompt-time recall and asynchronous memory extraction
visible without adding synthetic transcript messages or repeating retrieval.

## What it shows

- A single composer status line, for example:

  ```text
  ▸ OpenViking: recalled 4 · +2 created · ~1 updated  (/ov-memories)
  ```

- A scrollable session panel with two tabs:
  - **Recalled** — memories stored in
    `message.metadata.openviking.context` for the latest 20 user turns.
  - **Created / Updated** — add, update and delete operations recorded in
    `memory_diff.json` for the latest 20 completed OpenViking archives.

The panel is bounded to 12 visible rows and 100 extraction changes. Entries are
collapsed by default, deduplicated, and expanded bodies are capped at 2,000
characters.

## Design boundaries

- No prompt hook and no model-context changes.
- No synthetic OpenCode messages.
- No second semantic recall request.
- OpenViking archive reads happen asynchronously in the TUI with a 15-second
  cache and a 3-second request timeout.
- API credentials are read from `~/.openviking/ovcli.conf` and are never shown.
- The OpenCode-to-OpenViking session mapping is read from the active memory
  plugin's `openviking-session-state.json`.
- Created memories are attributed to an archive/commit batch, not falsely to a
  single prompt.

## Requirements

- OpenCode V2 2.0.18 or newer.
- The OpenViking OpenCode plugin with automatic recall/capture enabled.
- Local OpenViking configuration in `~/.openviking/ovcli.conf`.
- Node.js 22+ only for development and tests. OpenCode supplies the TUI plugin
  runtime when the plugin is loaded.

## Install from a checkout

Clone the repository, then add its directory to the global OpenCode CLI config
at `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": [
    "/absolute/path/to/ov-tui-status"
  ]
}
```

This is a **CLI plugin**, so it belongs in `cli.json`, not `opencode.json`.
Keep the existing OpenViking server plugin in `opencode.json`; the two plugins
have separate responsibilities.

The package exports `./tui` and declares `oc-plugin: ["tui"]` for OpenCode's
plugin discovery.

## Usage

Open an OpenCode session and use:

```text
/ov-memories
```

`/memories` is an alias. The panel keys are:

| Key | Action |
|---|---|
| `j` / Down | Next entry |
| `k` / Up | Previous entry |
| Enter | Expand or collapse |
| Tab | Switch tabs |
| `r` | Refresh extraction results |
| `f` | Toggle full screen |
| Escape | Close panel |

## Optional configuration

Pass options using the object plugin form in `cli.json`:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/ov-tui-status",
      "options": {
        "configPath": "/custom/ovcli.conf",
        "statePath": "/custom/openviking-session-state.json",
        "timeoutMs": 3000,
        "maxArchives": 20,
        "maxChanges": 100,
        "cacheTtlMs": 15000
      }
    }
  ]
}
```

## Development

```bash
npm install
npm run verify
```

The tests use fictional data and a mock HTTP transport. They do not submit a
real transcript or modify OpenViking.

## Current limitation

OpenCode does not currently expose a documented custom transcript message-part
renderer. This plugin therefore uses a one-line composer status plus the
official `session.panel` API rather than injecting fake tool calls into the
conversation.

## License

Apache-2.0.
