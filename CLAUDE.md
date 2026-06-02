# Godot LSP Plugin for Claude Code

Bridges Claude Code's native LSP support to Godot's GDScript Language Server via a stdio-to-TCP bridge.

## Prerequisites

Node.js (the bridge is Node). Then **either** mode:

- **Standalone (no editor) — recommended.** Set `GODOT_LSP_BIN` to a custom Godot
  build that carries the `gdscript_lsp_standalone` module (a headless `MainLoop`
  that runs the language server without `EditorNode`). The bridge auto-spawns it
  on demand and kills it on exit — no editor window, no manual host. See
  [Standalone mode](#standalone-mode-auto-spawn).
- **Editor host.** Leave `GODOT_LSP_BIN` unset and run a Godot 4.x editor (or a
  headless `godot --editor --lsp-port 6005`) with the project open. The bridge
  connects to whatever is already listening on the port.

The LSP server defaults to `localhost:6005`. Override via `GODOT_LSP_HOST`,
`GODOT_LSP_PORT`.

> **Why this bridge supersedes the original:** Godot 4.6's LSP *does* answer
> `initialize` (deferred ~3 s on the first connect while the workspace warms).
> The original bridge faked a response after 500 ms — shipping wrong capabilities
> *and* a duplicate response for the same request id, which crashes strict
> JSON-RPC clients (the "LSP server crashed 3×" symptom). This bridge forwards the
> real response and never fabricates one.

## Available LSP Operations

The `LSP` tool provides these operations for `.gd` files:

| Operation | What it does |
|---|---|
| `hover` | Type info and documentation at a position |
| `goToDefinition` | Jump to where a symbol is defined (cross-file) |
| `findReferences` | Find all usages of a symbol across the project |
| `documentSymbol` | List all symbols (signals, vars, funcs) in a file |

**Auto-diagnostics**: Diagnostics (errors, warnings) are reported automatically when `.gd` files are read or written. No manual call needed.

### Not supported by Godot's LSP

`workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls` — these return "Method not found".

## How to Use the LSP Tool

All operations require `filePath`, `line` (1-based), and `character` (1-based).

```
LSP(operation: "hover", filePath: "path/to/file.gd", line: 10, character: 5)
LSP(operation: "goToDefinition", filePath: "path/to/file.gd", line: 10, character: 5)
LSP(operation: "findReferences", filePath: "path/to/file.gd", line: 10, character: 5)
LSP(operation: "documentSymbol", filePath: "path/to/file.gd", line: 1, character: 1)
```

Use **absolute paths** for `filePath`.

## Workflows

### After editing a .gd file
Diagnostics appear automatically. If errors are reported, fix them before moving on.

### Exploring unfamiliar GDScript code
1. `documentSymbol` — understand file structure (signals, vars, methods)
2. `hover` on unknown symbols — get type info and Godot engine docs
3. `goToDefinition` — jump to implementation, works cross-file

### Before refactoring
1. `findReferences` — see all usages to understand impact
2. Make changes
3. Check diagnostics on affected files

## Interpreting Results

- **Hover returns empty**: cursor isn't on a symbol, or file has parse errors preventing indexing
- **No references found**: symbol is unused, or workspace hasn't fully indexed
- **No symbols in document**: file has parse errors too severe for Godot to index
- **Diagnostics with "Unexpected <"** (editor-host mode only): the editor's in-memory file view is stale vs disk — save in the editor, or switch to standalone mode (it reads from disk and re-parses on `didChange`)
- **Connection error**: no host is listening and `GODOT_LSP_BIN` is unset — set `GODOT_LSP_BIN` to auto-spawn, or start a host

## Architecture

```
Claude Code  <--stdio-->  bridge.js  <--TCP:6005-->  GDScript Language Server
                              |                        (standalone MainLoop, or editor host)
                              └─ auto-spawns the standalone when GODOT_LSP_BIN is set
```

The bridge forwards the real `initialize` response (no fabricated one). When
`GODOT_LSP_BIN` is set and nothing is listening on the port, it launches
`<bin> --headless --path <project> --main-loop GDScriptLSPMainLoop --lsp-port <port>`,
waits for the port, connects, and terminates the child on exit.

## Standalone mode (auto-spawn)

Requires a custom Godot build carrying the `gdscript_lsp_standalone` engine module
(see the SnowGlobe repo: `tools/godot-modules/gdscript_lsp_standalone/` + the
`gdscript_lsp_standalone.patch`). Point `GODOT_LSP_BIN` at that binary:

```sh
export GODOT_LSP_BIN=/path/to/godot          # custom build with the LSP module
# (optional) export GODOT_LSP_PORT=6005
```

The bridge then needs no running editor: it spawns a headless, editor-free host on
demand. The first `initialize` takes ~3-5 s (project symbol warmup); subsequent
requests are instant. The project root is the nearest ancestor of the working
directory containing `project.godot` (override with `GODOT_LSP_ROOT`).

## Configuration

Environment variables:
- `GODOT_LSP_BIN` — custom Godot build with the standalone LSP module; **enables auto-spawn**. Unset → connect-only (editor-host mode).
- `GODOT_LSP_HOST` — default `127.0.0.1`
- `GODOT_LSP_PORT` — default `6005`
- `GODOT_LSP_ROOT` — project root for auto-spawn (default: nearest ancestor with `project.godot`)
- `BRIDGE_WATCH=1` — watch the project for external `.gd` writes and push `didChange` for opened files (covers edits the client can't see)
- `BRIDGE_INIT_FALLBACK_MS` — hard-fallback if the server never answers `initialize` (default `30000`)
- `BRIDGE_DEBUG=1` — log bridge lifecycle + frames to stderr
