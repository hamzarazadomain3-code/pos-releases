#!/usr/bin/env node
/**
 * The LIVE voice + photo check (optional) — the real things, once.
 *
 * This script is NOT part of `npm test` and it never runs by accident:
 *
 *   npm run eval:assistant:voice:live -- --live
 *
 * Without `--live` it only says what it would do and exits 0.
 *
 * It proves two things on this computer:
 *
 *   1. the VOICE: the Windows speech synthesiser says a sentence into a WAV
 *      file and the app's own OFFLINE recogniser reads it back — no cloud,
 *      no key, no network,
 *   2. the PHOTOS: a picture goes to the REAL model (NVIDIA's free tier) and
 *      the model describes what it sees.
 *
 * The API key is read from the provider's environment variable. It is NEVER
 * printed, never logged and never written to a file — only the outcome is.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-voice-live-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-voice-live.db');

/** The picture the model looks at: a red square with a white band. */
function pictureBase64() {
  const zlib = require('zlib');
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc32 = (buf) => {
    let crc = -1;
    for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const w = 96;
  const h = 96;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y += 1) {
    const row = y * (1 + w * 3);
    for (let x = 0; x < w; x += 1) {
      const white = y > 40 && y < 56;
      const p = row + 1 + x * 3;
      raw[p] = white ? 255 : 220;
      raw[p + 1] = white ? 255 : 20;
      raw[p + 2] = white ? 255 : 20;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

/** The Windows speech synthesiser says a sentence into a WAV file. */
function speakToWav(sentence, wavPath) {
  const script = path.join(tmpDir, 'speak.ps1');
  fs.writeFileSync(
    script,
    [
      'param([string]$Sentence, [string]$Out)',
      'Add-Type -AssemblyName System.Speech',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$synth.SetOutputToWaveFile($Out)',
      '$synth.Speak($Sentence)',
      '$synth.Dispose()',
    ].join('\n'),
    'utf8'
  );
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Sentence', sentence, '-Out', wavPath],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return fs.readFileSync(wavPath).toString('base64');
}

async function run() {
  const live = process.argv.includes('--live');
  if (!live) {
    console.log('The live voice check is OFF by default.');
    console.log('Run it with:  npm run eval:assistant:voice:live -- --live');
    console.log('It would speak a sentence with the Windows voice, read it back with the app\'s own offline recogniser, and ask the real model about a picture.');
    app.exit(0);
    return;
  }

  const { initDatabase } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const voiceService = require('../dist/main/services/assistant/voice.js');
  const settingsService = require('../dist/main/services/assistant/settings.js');
  const agentService = require('../dist/main/services/assistant/agent.js');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  let failures = 0;
  const report = (name, ok, detail) => {
    if (!ok) failures++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  };

  console.log('\n=== The offline voice (Windows itself) ===');
  const sentence = 'What is the total sale of today';
  const wavPath = path.join(tmpDir, 'spoken.wav');
  const wavBase64 = speakToWav(sentence, wavPath);
  console.log(`  the Windows voice said: "${sentence}" (${wavBase64.length} base64 chars)`);
  const heard = await voiceService.transcribeWav(wavBase64);
  report('the app heard something', heard.ok, heard.message);
  console.log(`  the app heard: "${heard.text}"`);
  const expected = 'total sale';
  report(
    'the words came back right',
    heard.text.toLowerCase().includes(expected),
    heard.text
  );

  console.log('\n=== The photo (the real model) ===');
  const key = process.env.NVIDIA_API_KEY || process.env.NVIDIA_INFERENCE_API_KEY;
  report('the provider key is in the environment', !!key);
  if (key) {
    settingsService.saveAssistantSettings({
      provider: 'nvidia',
      // AUTO: the router must send the photo to the vision model and keep the
      // text turns on the configured/default text model.
      model: 'auto',
      enabled: true,
    });
    const turn = await agentService.runAssistantTurn({
      message: 'What colour is this picture? Answer with one word.',
      attachments: [
        { kind: 'image', mediaType: 'image/png', name: 'picture.png', data: pictureBase64() },
      ],
    });
    console.log(`  the model said: "${turn.text}"`);
    report('the model answered', turn.ok, turn.failure && turn.failure.message);
    const answer = String(turn.text || '').toLowerCase();
    report('the model saw the red', answer.includes('red'), turn.text);
    report('the source line says the vision model answered', String(turn.source || '').includes('vision model'), turn.source);
  }

  console.log(`\n${failures === 0 ? 'ALL LIVE CHECKS PASSED' : `${failures} LIVE CHECK(S) FAILED`}`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(async () => {
  try {
    await run();
  } catch (e) {
    console.log(`  [FAIL] the live check threw -- ${e && e.stack ? e.stack : e}`);
    app.exit(1);
  }
});
