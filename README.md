# Godot LSP Plugin for Claude Code

A [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code) that connects Claude to Godot's built-in GDScript Language Server, giving Claude type-aware intelligence when working with `.gd` files.

## Quick start

```sh
# 1. Clone the plugin
git clone https://github.com/Smitner-Studio/godot-lsp-plugin.git

# 2. Open your Godot project in the editor, then:
cd /path/to/your-godot-project
claude --plugin-dir /path/to/godot-lsp-plugin
```

That's it — Claude now has full GDScript language intelligence.

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

## Prerequisites

- **Godot 4.x editor** running with your project open (the LSP server only runs while the editor is open)
- **Node.js** (any recent version)

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
