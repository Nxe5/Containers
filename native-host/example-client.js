#!/usr/bin/env node
'use strict';

/**
 * Minimal example of talking to the Company Containers native-messaging
 * bridge (native-host/index.js) from an external script — e.g. the
 * connection a Playwright automation would open before filling a login
 * form. This is a reference for the wire protocol, not a Playwright
 * integration itself: one JSON object per line, newline-delimited, over a
 * Unix domain socket.
 *
 * Usage:
 *   node native-host/example-client.js <website> <token>
 *   CC_TOKEN=<token> node native-host/example-client.js <website>
 *
 * The token comes from the extension's Options page (Native Messaging
 * section, "Regenerate token"). The extension must be running and its vault
 * unlocked, or this will fail with { error: "vault-locked" }.
 */

const net = require('net');
const os = require('os');
const path = require('path');

const website = process.argv[2];
const token = process.env.CC_TOKEN || process.argv[3];

if (!website || !token) {
  console.error('Usage: node example-client.js <website> <token>');
  console.error('   or: CC_TOKEN=<token> node example-client.js <website>');
  process.exit(1);
}

const socketPath = path.join(os.homedir(), '.company-containers', 'host.sock');
const socket = net.createConnection(socketPath, () => {
  socket.write(JSON.stringify({ id: '1', type: 'get-credential', token, website }) + '\n');
});

let buffer = '';
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const idx = buffer.indexOf('\n');
  if (idx < 0) return;

  const response = JSON.parse(buffer.slice(0, idx));
  if (response.ok) {
    console.log(JSON.stringify(response.result, null, 2));
  } else {
    console.error('Request failed:', response.error);
    process.exitCode = 1;
  }
  socket.end();
});

socket.on('error', (err) => {
  console.error('Could not reach native host socket:', err.message);
  console.error('Is Firefox running with the extension loaded, and did you run scripts/install-native-host.sh?');
  process.exit(1);
});
