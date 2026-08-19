#!/usr/bin/env node
const fetch = require('node-fetch');
const path = require('path');
const SERVER_URL = process.env.SERVER_URL || 'https://license-server-2th8.onrender.com';

async function generate(shop) {
  const res = await fetch(`${SERVER_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop })
  });
  const data = await res.json();
  console.log('KEY:', data.key);
  console.log('EXPIRES:', data.expires);
}

async function revoke(key) {
  await fetch(`${SERVER_URL}/api/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key })
  });
  console.log('Revoked', key);
}

async function list() {
  const res = await fetch(`${SERVER_URL}/api/active`);
  const data = await res.json();
  console.table(data);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'generate':
      if (!args[0]) { console.error('Usage: generate <shop-name>'); process.exit(1); }
      await generate(args[0]);
      break;
    case 'revoke':
      if (!args[0]) { console.error('Usage: revoke <key>'); process.exit(1); }
      await revoke(args[0]);
      break;
    case 'list':
      await list();
      break;
    default:
      console.log('Commands: generate <shop>, revoke <key>, list');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
