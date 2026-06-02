# Godot LSP Plugin for Claude Code

A [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code) that gives Claude type-aware GDScript intelligence — hover, go-to-definition, find-references, document symbols, and live diagnostics for `.gd` files — by bridging Claude Code's LSP support to Godot's GDScript Language Server.

Two server modes, one plugin:

- **Standalone (recommended for agent use)** — an editor-free, headless GDScript language server. No editor window, always-on, and it reads from disk so edits made outside an editor (by Claude, git, or other tools) never go stale. The bridge auto-spawns it on demand and shuts it down on exit. Requires a Godot build carrying the `gdscript_lsp_standalone` module — see [Standalone mode](#standalone-mode).
- **Editor host (zero-setup, stock Godot)** — connects to the LSP that any Godot 4.x editor already serves while your project is open. Nothing to build; works with the Godot you already have.

## Quick start

**Recommended — persistent install via marketplace:**

Inside Claude Code, run:

```
/plugin marketplace add Smitner-Studio/godot-lsp-plugin
/plugin install godot-lsp@smitner-studio
```

The plugin loads automatically in every Claude session after this.

**Quick try — load for one session only:**

```sh
git clone https://github.com/Smitner-Studio/godot-lsp-plugin.git

# In your Godot project directory:
claude --plugin-dir /path/to/godot-lsp-plugin
```

On Windows, use a native path (`C:\path\to\godot-lsp-plugin`) — both forward and backslashes work in PowerShell.

`--plugin-dir` is **session-scoped** — pass the flag every time you start Claude. Use the marketplace install above for a persistent setup.

With no extra configuration the plugin uses **editor-host** mode: open your project in a Godot 4.x editor and the bridge connects to its LSP. For the headless, always-on path, set up [Standalone mode](#standalone-mode).

## Standalone mode

The standalone server runs the GDScript LSP **without an editor**. The bridge launches it on demand (`--headless --main-loop GDScriptLSPMainLoop --lsp-port <port>`), waits for the port, serves, and kills the child when Claude exits — no window, no manual host management.

It needs a Godot build that includes two things:

1. **The headless-LSP engine changes** — they let the language server run without `EditorNode`. Build from our fork: **[Smitner-Studio/godot @ `lsp-headless`](https://github.com/Smitner-Studio/godot/tree/lsp-headless)**. These changes are proposed upstream (a defensive "don't crash headless" hardening PR); once they land, stock Godot will support this natively and no fork will be needed.
2. **The `gdscript_lsp_standalone` module** — a small `MainLoop` that drives the server headless. Drop it into `modules/` of the fork checkout before building.

Then point the plugin at the resulting binary:

```sh
export GODOT_LSP_BIN=/path/to/godot      # the standalone-capable build
# optional: export GODOT_LSP_PORT=6005
```

On Windows set it as a user environment variable (so every Claude session inherits it) or in your shell profile. When `GODOT_LSP_BIN` is set the bridge auto-spawns the standalone; when it's unset the bridge falls back to editor-host mode. The first `initialize` takes ~3–5 s while the project's symbols warm up; subsequent requests are instant.

## What it does

- **Hover** — type info and Godot engine documentation at any symbol
- **Go to Definition** — jump to where a symbol is defined, across files
- **Find References** — locate all usages of a symbol in the project
- **Document Symbols** — list all signals, variables, and functions in a file
- **Auto-diagnostics** — errors and warnings reported automatically when `.gd` files are read or written

## How it works

```
Claude Code  <──stdio──>  bridge.js  <──TCP:6005──>  GDScript Language Server
                              │                       (standalone MainLoop, or editor host)
                              └─ auto-spawns the standalone when GODOT_LSP_BIN is set
```

Godot's LSP speaks TCP; Claude Code's LSP support speaks stdio. `bridge.js` bridges the two and forwards Godot's **real** `initialize` response (earlier versions faked one after 500 ms, which shipped wrong capabilities and crashed strict clients — that is fixed). The bridge uses only Node's standard library — **no `npm install` required**.

## Prerequisites

- **Node.js 14+** (any recent version)
- **Either** a standalone-capable Godot build (standalone mode) **or** a running Godot 4.x editor with your project open (editor-host mode)

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GODOT_LSP_BIN` | *(unset)* | Path to a standalone-capable Godot build. Set → the bridge auto-spawns the editor-free standalone. Unset → editor-host mode. |
| `GODOT_LSP_HOST` | `127.0.0.1` | LSP server host |
| `GODOT_LSP_PORT` | `6005` | LSP server port |
| `GODOT_LSP_ROOT` | nearest ancestor with `project.godot` | Project root used when auto-spawning the standalone |
| `BRIDGE_WATCH` | *(off)* | `=1` watches the project for external `.gd` writes and pushes `didChange` for opened files (covers edits the client can't see) |

## Included agents

The plugin ships with two specialized agents:

- **gdscript-explore** — maps codebase structure using LSP: lists symbols, traces definitions, finds references, and builds understanding of code relationships
- **gdscript-validate** — checks `.gd` files for errors via LSP diagnostics, reports issues, and can auto-fix common problems

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Connection error | No host listening and `GODOT_LSP_BIN` unset | Set `GODOT_LSP_BIN` to a standalone build, or open your project in a Godot editor |
| Hover returns empty | Cursor not on a symbol, or file has parse errors | Fix parse errors first |
| No references found | Symbol unused or workspace not indexed | Wait a moment for indexing |
| Diagnostics show "Unexpected <" (editor-host only) | The editor's in-memory view is stale vs disk | Save the file in the editor, or switch to standalone mode (it reads from disk and re-parses on edit) |

## License

MIT
