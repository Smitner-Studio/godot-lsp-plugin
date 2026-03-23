#!/usr/bin/env node
// Bridges stdio (Claude Code LSP client) <-> TCP (Godot LSP server)
// Handles Godot's quirk of sending notifications before/instead of initialize response.
const net = require("net");

const host = process.env.GODOT_LSP_HOST || "localhost";
const port = parseInt(process.env.GODOT_LSP_PORT || "6005", 10);

const INIT_TIMEOUT_MS = 500;

let socket = null;
let initializeId = null;
let initResponseSent = false;

// Parse LSP messages from a raw byte stream
function createMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);

  return function feed(chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const sep = buffer.indexOf("\r\n\r\n");
      if (sep === -1) break;

      const headerStr = buffer.slice(0, sep).toString("utf8");
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(sep + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const messageStart = sep + 4;
      const messageEnd = messageStart + contentLength;

      if (buffer.length < messageEnd) break;

      const body = buffer.slice(messageStart, messageEnd);
      buffer = buffer.slice(messageEnd);

      onMessage(body);
    }
  };
}

function encodeMessage(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function forwardToClient(body) {
  const header = `Content-Length: ${body.length}\r\n\r\n`;
  process.stdout.write(header);
  process.stdout.write(body);
}

function forwardToServer(body) {
  if (socket && !socket.destroyed) {
    const header = `Content-Length: ${body.length}\r\n\r\n`;
    socket.write(header);
    socket.write(body);
  }
}

// --- Server -> Client ---

const parseFromServer = createMessageParser((body) => {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    forwardToClient(body);
    return;
  }

  if (initializeId !== null && msg.id === initializeId) {
    initResponseSent = true;
  }

  forwardToClient(body);
});

// --- Client -> Server ---

const parseFromClient = createMessageParser((body) => {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    forwardToServer(body);
    return;
  }

  if (msg.method === "initialize" && msg.id != null) {
    initializeId = msg.id;
    initResponseSent = false;

    forwardToServer(body);

    // Godot often doesn't send an initialize response — synthesize one after timeout
    setTimeout(() => {
      if (!initResponseSent) {
        initResponseSent = true;
        process.stdout.write(encodeMessage({
          jsonrpc: "2.0",
          id: initializeId,
          result: {
            capabilities: {
              textDocumentSync: 1,
              completionProvider: { triggerCharacters: [".", '"'] },
              hoverProvider: true,
              definitionProvider: true,
              referencesProvider: true,
              documentSymbolProvider: true,
              renameProvider: true,
              signatureHelpProvider: { triggerCharacters: ["(", ","] },
            },
          },
        }));
      }
    }, INIT_TIMEOUT_MS);

    return;
  }

  forwardToServer(body);
});

// --- Connect ---

socket = net.createConnection({ host, port }, () => {
  process.stdin.on("data", (chunk) => parseFromClient(chunk));
});

socket.on("data", (chunk) => parseFromServer(chunk));

socket.on("error", (err) => {
  process.stderr.write(`Godot LSP connection error: ${err.message}\n`);
  process.exit(1);
});

socket.on("close", () => process.exit(0));
process.stdin.on("end", () => { if (socket && !socket.destroyed) socket.end(); });
