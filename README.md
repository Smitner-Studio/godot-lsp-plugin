# Godot LSP Plugin for Claude Code

A [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code) that connects Claude to Godot's built-in GDScript Language Server, giving Claude type-aware intelligence when working with `.gd` files.

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

`--plugin-dir` is **session-scoped** — you'll need to pass the flag every time you start Claude. Use the marketplace install above for a persistent setup.

## Verify it's working

With your project open in the Godot editor, start Claude in the project directory and ask it to hover a symbol in any `.gd` file. Type info and engine docs in the response mean the bridge is connected. If hover returns empty or you see a connection error, see [Troubleshooting](#troubleshooting).

## What it does

- **Hover** — type info and Godot engine documentation at any symbol
- **Go to Definition** — jump to where a symbol is defined, across files
- **Find References** — locate all usages of a symbol in the project
- **Document Symbols** — list all signals, variables, and functions in a file
- **Auto-diagnostics** — errors and warnings reported automatically when `.gd` files are read or written

## How it works

```
Claude Code  <──stdio──>  bridge.js  <──TCP:6005──>  Godot LSP Server
```

Godot 4.x ships with a built-in LSP server, but it speaks TCP. Claude Code's LSP support uses stdio. `bridge.js` bridges the two protocols, including a workaround for Godot's quirk of not always sending an `initialize` response.

The bridge uses only Node's standard library — **no `npm install` required**.

## Prerequisites

- **Godot 4.x editor** running with your project open (the LSP server only runs while the editor is open)
- **Node.js 14+** (any recent version)

## Configuration

Override the default connection with environment variables:

| Variable | Default | Description |
|---|---|---|
| `GODOT_LSP_HOST` | `localhost` | Godot LSP server host |
| `GODOT_LSP_PORT` | `6005` | Godot LSP server port |

## Included agents

The plugin ships with two specialized agents:

- **gdscript-explore** — maps codebase structure using LSP: lists symbols, traces definitions, finds references, and builds understanding of code relationships
- **gdscript-validate** — checks `.gd` files for errors via LSP diagnostics, reports issues, and can auto-fix common problems

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Connection error | Godot editor not running | Open your project in Godot |
| Hover returns empty | Cursor not on a symbol, or file has parse errors | Fix parse errors first |
| No references found | Symbol unused or workspace not indexed | Wait a moment, or re-save the file in Godot |
| Diagnostics show "Unexpected <" | Stale LSP cache | Save the file in the Godot editor |

## License

MIT
