#!/usr/bin/env node
'use strict';

/**
 * Native Messaging host for Company Containers.
 *
 * Firefox spawns this process when the extension calls
 * browser.runtime.connectNative(). It speaks the native-messaging framing
 * protocol (4-byte little-endian length prefix + UTF-8 JSON) on stdin/stdout,
 * and separately opens a local Unix domain socket that an external
 * automation script (e.g. a Playwright script) connects to. Requests coming
 * in on the socket are relayed to the extension over stdio; the extension's
 * response is relayed back to the socket client. This process never sees the
 * vault's master password or the vault's decryption key — it only ever sees
 * whatever the extension chooses to send back for a given request.
 */

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SOCKET_DIR = path.join(os.homedir(), '.company-containers');
const SOCKET_PATH = path.join(SOCKET_DIR, 'host.sock');

// --- Native messaging framing (stdio <-> extension) ------------------------

let stdinBuffer = Buffer.alloc(0);

function sendToExtension(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function handleStdinData(chunk) {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  while (stdinBuffer.length >= 4) {
    const length = stdinBuffer.readUInt32LE(0);
    if (stdinBuffer.length < 4 + length) break;
    const jsonBuf = stdinBuffer.subarray(4, 4 + length);
    stdinBuffer = stdinBuffer.subarray(4 + length);
    try {
      handleExtensionMessage(JSON.parse(jsonBuf.toString('utf8')));
    } catch (err) {
      process.stderr.write(`[native-host] bad message from extension: ${err.message}\n`);
    }
  }
}

process.stdin.on('data', handleStdinData);
process.stdin.on('end', () => process.exit(0));

// --- Pending request correlation --------------------------------------------
// One socket client request in flight per connection at a time; internalId
// maps back to which socket (and the client's own request id) to reply to.

let nextRequestId = 1;
const pending = new Map(); // internalId -> { socket, clientId }

function handleExtensionMessage(message) {
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  const { socket, clientId } = entry;
  if (socket.writable) {
    socket.write(
      JSON.stringify({
        id: clientId,
        ok: message.ok,
        result: message.result,
        error: message.error,
      }) + '\n'
    );
  }
}

// --- Local Unix socket (external automation clients) ------------------------

function ensureSocketDir() {
  fs.mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 });
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
}

function handleSocketRequest(socket, line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    socket.write(JSON.stringify({ ok: false, error: 'invalid-json' }) + '\n');
    return;
  }

  const internalId = String(nextRequestId++);
  pending.set(internalId, { socket, clientId: request.id });

  sendToExtension({
    id: internalId,
    type: request.type,
    token: request.token,
    website: request.website,
    containerKey: request.containerKey,
  });
}

function startSocketServer() {
  ensureSocketDir();

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) handleSocketRequest(socket, line);
      }
    });
    socket.on('error', () => {});
  });

  server.on('error', (err) => {
    process.stderr.write(`[native-host] socket server error: ${err.message}\n`);
  });

  server.listen(SOCKET_PATH, () => {
    fs.chmodSync(SOCKET_PATH, 0o600);
  });

  const cleanup = () => {
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // already gone
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  return server;
}

startSocketServer();
