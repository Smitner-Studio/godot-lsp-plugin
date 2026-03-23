# Godot LSP Plugin for Claude Code

Bridges Claude Code's native LSP support to Godot's built-in GDScript Language Server via a stdio-to-TCP bridge.

## Prerequisites

- **Godot 4.x editor must be running** with the project open
- Godot's LSP server runs on `localhost:6005` by default
- Node.js must be installed (used by the bridge)

Override host/port via env vars: `GODOT_LSP_HOST`, `GODOT_LSP_PORT`.

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
- **Diagnostics with "Unexpected <"**: stale LSP cache, save the file in Godot editor to refresh
- **Connection error**: Godot editor isn't running or LSP is disabled

## Architecture

```
Claude Code  <--stdio-->  bridge.js  <--TCP:6005-->  Godot LSP Server
```

The bridge handles Godot's quirk of not sending an `initialize` response by synthesizing one after 500ms.

## Configuration

Override defaults with environment variables:
- `GODOT_LSP_HOST` — default: `localhost`
- `GODOT_LSP_PORT` — default: `6005`
