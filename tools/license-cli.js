#!/usr/bin/env node
const fetch = require('node-fetch');
const path = require('path');
const readline = require('readline');
const SERVER_URL = process.env.SERVER_URL || 'https://license-server-2th8.onrender.com';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

async function generate(shop) {
  // Interactive prompts for optional metadata
  const contact_phone = await ask('Contact phone (optional): ');
  const contact_address = await ask('Contact address (optional): ');
  const payment_amount_raw = await ask('Payment amount (optional, numeric): ');
  const payment_method = await ask('Payment method (optional): ');
  const payment_status = await ask('Payment status (optional, default pending): ');
  const notes = await ask('Notes (optional): ');
  const plan_type = await ask('Plan type (optional, default basic): ');
  const max_devices_raw = await ask('Max devices (optional, default 1): ');
  const activated_devices_raw = await ask('Activated devices (comma‑separated, optional): ');

  const payload = {
    shop,
    contact_phone: contact_phone || undefined,
    contact_address: contact_address || undefined,
    payment_amount: payment_amount_raw ? Number(payment_amount_raw) : undefined,
    payment_method: payment_method || undefined,
    payment_status: payment_status || undefined,
    notes: notes || undefined,
    plan_type: plan_type || undefined,
    max_devices: max_devices_raw ? Number(max_devices_raw) : undefined,
    activated_devices: activated_devices_raw ? activated_devices_raw.split(',').map(v => v.trim()).filter(Boolean) : undefined,
  };
  // Strip undefined values to keep payload clean
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  const res = await fetch(`${SERVER_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  console.log('KEY:', data.key);
  console.log('EXPIRES:', data.expires);
}

async function revoke(key) {
  await fetch(`${SERVER_URL}/api/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  console.log('Revoked', key);
}

async function list() {
  const res = await fetch(`${SERVER_URL}/api/active`);
  const data = await res.json();
  console.table(data);
}

async function renew(key, newExpires) {
  const res = await fetch(`${SERVER_URL}/api/renew`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, new_expires: newExpires }),
  });
  const data = await res.json();
  if (data.ok) console.log(`Renewed ${key}, new expiry: ${data.expires}`);
  else console.error('Renew failed:', data.msg);
}

async function history(key) {
  const res = await fetch(`${SERVER_URL}/api/history/${key}`);
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
    case 'renew':
      if (!args[0] || !args[1]) { console.error('Usage: renew <key> <new-expires-ISO>'); process.exit(1); }
      await renew(args[0], args[1]);
      break;
    case 'history':
      if (!args[0]) { console.error('Usage: history <key>'); process.exit(1); }
      await history(args[0]);
      break;
    default:
      console.log('Commands: generate <shop>, revoke <key>, list, renew <key> <new-expires-ISO>, history <key>');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
