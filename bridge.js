#!/usr/bin/env node
// stdio (LSP client) <-> TCP (Godot GDScript Language Server) bridge, with
// optional auto-spawn of the editor-free standalone host.
//
// Supersedes the godot-lsp plugin's original bridge. Two corrections + one feature:
//
//  1. NO FAKE INITIALIZE. The original faked an `initialize` response after 500ms
//     on the belief "Godot doesn't send one." Empirically (Godot 4.6) the server
//     DOES respond — deferred ~2.5-3s on the first connection while the workspace
//     warms. The 500ms fake fired first, shipped WRONG capabilities, AND produced
//     a duplicate response for the same request id, which crashes strict JSON-RPC
//     clients (the "LSP server crashed 3x" symptom). Fix: forward the real one;
//     never fabricate. A long BRIDGE_INIT_FALLBACK_MS (default 30s) hard-fallback
//     remains only for a wedged server, logged loudly.
//
//  2. AUTO-SPAWN STANDALONE (opt-in via GODOT_LSP_BIN). If nothing is already
//     listening on the port and GODOT_LSP_BIN points at a custom Godot build that
//     carries the gdscript_lsp_standalone module, the bridge launches
//        <bin> --headless --path <project> --main-loop GDScriptLSPMainLoop --lsp-port <port>
//     waits for the port, connects, and kills the child when the bridge exits.
//     No editor, no GUI, no manual host management. If GODOT_LSP_BIN is unset, the
//     bridge is connect-only (expects a host already running — task lsp:host or
//     lsp:standalone), preserving the original behaviour.
//
//  3. DISK-WATCH (opt-in via BRIDGE_WATCH=1). Watches the project for external .gd
//     writes and pushes didChange (full content) for files the client has opened —
//     covers edits the client's own LSP integration can't see (git ops, other tools).
//
// Env:
//   GODOT_LSP_HOST  (default 127.0.0.1)
//   GODOT_LSP_PORT  (default 6005)
//   GODOT_LSP_BIN   (path to the custom Godot build; enables auto-spawn)
//   GODOT_LSP_ROOT  (project root; default = nearest ancestor of cwd with project.godot)
//   BRIDGE_INIT_FALLBACK_MS (default 30000)
//   BRIDGE_SPAWN_TIMEOUT_MS (default 30000; how long to wait for the spawned port)
//   BRIDGE_WATCH    (1 to enable disk-watch)
//   BRIDGE_DEBUG    (1 to log frames/lifecycle to stderr)

const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const HOST = process.env.GODOT_LSP_HOST || "127.0.0.1";
const PORT = parseInt(process.env.GODOT_LSP_PORT || "6005", 10);
const BIN = process.env.GODOT_LSP_BIN || "";
const FALLBACK_MS = parseInt(process.env.BRIDGE_INIT_FALLBACK_MS || "30000", 10);
const SPAWN_TIMEOUT_MS = parseInt(process.env.BRIDGE_SPAWN_TIMEOUT_MS || "30000", 10);
const WATCH = process.env.BRIDGE_WATCH === "1";
const DEBUG = process.env.BRIDGE_DEBUG === "1";

const log = (...a) => process.stderr.write(`[bridge] ${a.join(" ")}\n`);
const dbg = (...a) => { if (DEBUG) log(...a); };

function findProjectRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "project.godot"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start); // no project.godot found: fall back to cwd
    dir = parent;
  }
}
const ROOT = process.env.GODOT_LSP_ROOT || findProjectRoot(process.cwd());

let socket = null;
let child = null;
let initializeId = null;
let initResponseSent = false;
let fallbackTimer = null;
const openDocs = new Map(); // uri -> latest text (for disk-watch resend)

// ---- framing ----
function frame(bodyBuf) {
  return Buffer.concat([Buffer.from(`Content-Length: ${bodyBuf.length}\r\n\r\n`, "utf8"), bodyBuf]);
}
function makeParser(onBody) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep === -1) break;
      const m = buf.slice(0, sep).toString("utf8").match(/Content-Length:\s*(\d+)/i);
      if (!m) { buf = buf.slice(sep + 4); continue; }
      const len = parseInt(m[1], 10), start = sep + 4;
      if (buf.length < start + len) break;
      onBody(buf.slice(start, start + len));
      buf = buf.slice(start + len);
    }
  };
}
const toClient = (b) => process.stdout.write(frame(b));
const toServer = (b) => { if (socket && !socket.destroyed) socket.write(frame(b)); };

// ---- server -> client ----
const parseFromServer = makeParser((bodyBuf) => {
  let msg = null; try { msg = JSON.parse(bodyBuf.toString("utf8")); } catch {}
  if (msg && initializeId !== null && msg.id === initializeId && msg.result) {
    initResponseSent = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    dbg("real initialize response forwarded");
  }
  toClient(bodyBuf);
});

// ---- client -> server ----
const parseFromClient = makeParser((bodyBuf) => {
  let msg = null; try { msg = JSON.parse(bodyBuf.toString("utf8")); } catch {}

  if (msg && msg.method === "initialize" && msg.id != null) {
    initializeId = msg.id;
    initResponseSent = false;
    toServer(bodyBuf);
    fallbackTimer = setTimeout(() => {
      if (!initResponseSent) {
        initResponseSent = true;
        log(`WARNING: no initialize response after ${FALLBACK_MS}ms — server may be mid-scan or wedged; sending minimal fallback capabilities.`);
        toClient(Buffer.from(JSON.stringify({
          jsonrpc: "2.0", id: initializeId,
          result: { capabilities: {
            textDocumentSync: 1,
            completionProvider: { resolveProvider: true, triggerCharacters: [".", "$", "'", '"'] },
            hoverProvider: true, definitionProvider: true, declarationProvider: true,
            referencesProvider: true, documentSymbolProvider: true, renameProvider: true,
            signatureHelpProvider: { triggerCharacters: ["(", ","] },
          } },
        }), "utf8"));
      }
    }, FALLBACK_MS);
    return;
  }

  if (msg && msg.method === "textDocument/didOpen" && msg.params?.textDocument?.uri) {
    openDocs.set(msg.params.textDocument.uri, msg.params.textDocument.text || "");
  } else if (msg && msg.method === "textDocument/didChange" && msg.params?.textDocument?.uri) {
    const last = msg.params.contentChanges?.[msg.params.contentChanges.length - 1];
    if (last && last.text !== undefined) openDocs.set(msg.params.textDocument.uri, last.text);
  } else if (msg && msg.method === "textDocument/didClose" && msg.params?.textDocument?.uri) {
    openDocs.delete(msg.params.textDocument.uri);
  }
  toServer(bodyBuf);
});

// ---- disk-watch ----
function pathToUri(p) { return "file:///" + path.resolve(p).replace(/\\/g, "/"); }
let docVersion = 1000;
function startWatch() {
  let timer = null;
  const pending = new Set();
  const flush = () => {
    timer = null;
    for (const abs of pending) {
      const uri = pathToUri(abs);
      if (!openDocs.has(uri)) continue;
      let text; try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
      if (text === openDocs.get(uri)) continue;
      openDocs.set(uri, text);
      toServer(Buffer.from(JSON.stringify({
        jsonrpc: "2.0", method: "textDocument/didChange",
        params: { textDocument: { uri, version: ++docVersion }, contentChanges: [{ text }] },
      }), "utf8"));
      dbg("disk-watch -> didChange", abs);
    }
    pending.clear();
  };
  try {
    fs.watch(ROOT, { recursive: true }, (_e, file) => {
      if (!file || !file.endsWith(".gd")) return;
      pending.add(path.resolve(ROOT, file));
      if (!timer) timer = setTimeout(flush, 120);
    });
    log(`disk-watch active on ${ROOT}`);
  } catch (e) { log(`disk-watch failed: ${e.message}`); }
}

// ---- auto-spawn + connect ----
function probePort(cb) {
  const s = net.connect({ host: HOST, port: PORT });
  let done = false;
  const finish = (up) => { if (done) return; done = true; s.destroy(); cb(up); };
  s.on("connect", () => finish(true));
  s.on("error", () => finish(false));
  setTimeout(() => finish(false), 800);
}
function waitForPort(deadline, cb) {
  probePort((up) => {
    if (up) return cb(true);
    if (Date.now() > deadline) return cb(false);
    setTimeout(() => waitForPort(deadline, cb), 250);
  });
}
function spawnStandalone() {
  log(`auto-spawning standalone: ${BIN} --headless --path ${ROOT} --main-loop GDScriptLSPMainLoop --lsp-port ${PORT}`);
  child = spawn(BIN, ["--headless", "--path", ROOT, "--main-loop", "GDScriptLSPMainLoop", "--lsp-port", String(PORT)], {
    stdio: DEBUG ? ["ignore", "inherit", "inherit"] : "ignore",
    windowsHide: true,
  });
  child.on("exit", (code) => { dbg(`standalone exited (${code})`); child = null; });
  child.on("error", (e) => log(`standalone spawn error: ${e.message}`));
}
function connect() {
  socket = net.createConnection({ host: HOST, port: PORT }, () => {
    dbg(`connected ${HOST}:${PORT}`);
    process.stdin.on("data", parseFromClient);
    if (WATCH) startWatch();
  });
  socket.on("data", parseFromServer);
  socket.on("error", (err) => { log(`connection error: ${err.message}`); shutdown(1); });
  socket.on("close", () => shutdown(0));
}

function start() {
  probePort((up) => {
    if (up) { dbg("host already listening; connecting"); return connect(); }
    if (BIN) {
      spawnStandalone();
      waitForPort(Date.now() + SPAWN_TIMEOUT_MS, (ready) => {
        if (ready) return connect();
        log(`standalone did not bind ${HOST}:${PORT} within ${SPAWN_TIMEOUT_MS}ms`);
        shutdown(1);
      });
    } else {
      log(`nothing listening on ${HOST}:${PORT} and GODOT_LSP_BIN unset — connecting anyway (start a host with 'task lsp:standalone', or set GODOT_LSP_BIN to auto-spawn).`);
      connect();
    }
  });
}

// ---- lifecycle ----
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child && !child.killed) { try { child.kill(); } catch {} }
  process.exit(code);
}
process.on("exit", () => { if (child && !child.killed) { try { child.kill(); } catch {} } });
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.stdin.on("end", () => { if (socket && !socket.destroyed) socket.end(); shutdown(0); });

start();
