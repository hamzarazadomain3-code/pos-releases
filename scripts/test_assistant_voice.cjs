#!/usr/bin/env node
/**
 * The voice + photos of the assistant.
 *
 * The user asked for four things: the assistant must LISTEN, it must ANSWER
 * out loud, it must take an UPLOAD and it must SEE the photos. This suite
 * proves the whole chain over the REAL `dist` code:
 *
 *   1. the pure helpers (the WAV the recorder builds, the base64, the rules
 *      for which file may be attached, the gate that really decides what may
 *      leave the shop, and the clean-up of an answer before it is spoken),
 *   2. the request bodies — a photo becomes an `image_url` part for the
 *      OpenAI-compatible shape (NVIDIA) and an `image` block for Anthropic,
 *   3. the vision rules — the NVIDIA text model cannot see a photo, the
 *      vision model can, and a photo makes the turn use the vision model,
 *   4. the real turn (the MockProvider only — no LLM, no network) carries the
 *      attachment to the provider,
 *   5. the voice service — the app's own OFFLINE recogniser is on this
 *      computer, it needs no key, and an empty recording is refused politely,
 *   6. the wiring — the IPC, the preload, the panel's buttons, the two
 *      languages and the packaged resource.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistant_voice.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-voice-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-voice.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** A tiny PNG (a red square with a white band) — the photo in the tests. */
function tinyPngBase64() {
  const zlib = require('zlib');
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf) => {
    let crc = -1;
    for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
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
  const w = 8;
  const h = 8;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y += 1) {
    const row = y * (1 + w * 3);
    for (let x = 0; x < w; x += 1) {
      const p = row + 1 + x * 3;
      raw[p] = 220;
      raw[p + 1] = 20;
      raw[p + 2] = 20;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const voice = require('../dist/shared/assistant/voice.js');
  const shared = require('../dist/shared/assistant/provider.js');
  const { MockProvider } = require('../dist/shared/assistant/mockProvider.js');
  const runtime = require('../dist/main/services/assistant/runtime.js');
  const settingsService = require('../dist/main/services/assistant/settings.js');
  const agentService = require('../dist/main/services/assistant/agent.js');
  const voiceService = require('../dist/main/services/assistant/voice.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');
  const packageJson = require('../package.json');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  // ── 1. the pure helpers ─────────────────────────────────────────────────
  section('The recorder helpers (the real dist code)');
  const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = voice.encodeWav16k(pcm, 16000);
  check('the WAV starts with RIFF', Buffer.from(wav.slice(0, 4)).toString('ascii') === 'RIFF');
  check('the WAV says WAVE', Buffer.from(wav.slice(8, 12)).toString('ascii') === 'WAVE');
  check('the WAV has a 44-byte header', wav.length === 44 + pcm.length * 2, String(wav.length));
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  check('the sample rate is 16 kHz', view.getUint32(24, true) === 16000);
  check('the audio is mono', view.getUint16(22, true) === 1);
  check('the audio is 16-bit', view.getUint16(34, true) === 16);
  check('the data size matches the samples', view.getUint32(40, true) === pcm.length * 2);
  let loudest = 0;
  for (let i = 0; i < pcm.length; i += 1) loudest = Math.max(loudest, Math.abs(view.getInt16(44 + i * 2, true)));
  check('the loudest sample is not clipped to a click', loudest > 30000, String(loudest));
  const resampled = voice.downsampleTo16k(new Float32Array(32000), 48000);
  check('48 kHz is resampled to 16 kHz', resampled.length === Math.floor(32000 / 3), String(resampled.length));
  check('a 16 kHz input is left alone', voice.downsampleTo16k(new Float32Array(10), 16000).length === 10);

  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const b64 = voice.bytesToBase64(bytes);
  check('the base64 round-trips', Buffer.from(voice.base64ToBytes(b64)).equals(Buffer.from(bytes)));
  check('the text round-trips', voice.base64ToText(voice.textToBase64('aaj ki sale')) === 'aaj ki sale');

  const dataUrl = `data:image/png;base64,${tinyPngBase64()}`;
  const split = voice.splitDataUrl(dataUrl);
  check('the data URL gives the media type', split.mediaType === 'image/png');
  check('the data URL gives the payload', split.base64.length > 0);

  // ── 2. which file may be attached ───────────────────────────────────────
  section('Which file may be attached');
  check('a PNG is an image', voice.attachmentKindFor('bill.png', 'image/png') === 'image');
  check('a JPEG is an image', voice.attachmentKindFor('bill.jpg', 'image/jpeg') === 'image');
  check('a CSV is text', voice.attachmentKindFor('stock.csv', 'text/csv') === 'text');
  check('a JSON is text', voice.attachmentKindFor('data.json', 'application/json') === 'text');
  check('a PDF is refused', voice.attachmentKindFor('bill.pdf', 'application/pdf') === null);
  check('an EXE is refused', voice.attachmentKindFor('setup.exe', 'application/octet-stream') === null);
  check('the image limit is 4 MB', voice.maxBytesFor('image') === 4 * 1024 * 1024);
  check('the text limit is 20 KB', voice.maxBytesFor('text') === 20000);
  check('the name loses its path', voice.cleanAttachmentName('C:\\Users\\shop\\bill.png') === 'bill.png');

  section('The gate that decides what leaves the shop');
  const pngBase64 = tinyPngBase64();
  const accepted = voice.sanitizeAttachments([
    { kind: 'image', mediaType: 'image/png', name: 'bill.png', data: pngBase64 },
    { kind: 'text', mediaType: 'text/csv', name: 'stock.csv', data: voice.textToBase64('item,qty') },
  ]);
  check('both good files are accepted', accepted.attachments.length === 2);
  check('nothing is rejected', accepted.rejected.length === 0);
  const refused = voice.sanitizeAttachments([
    { kind: 'image', mediaType: 'application/pdf', name: 'bill.pdf', data: pngBase64 },
    { kind: 'image', mediaType: 'image/png', name: 'huge.png', data: 'A'.repeat(10 * 1024 * 1024) },
    { kind: 'text', mediaType: 'text/csv', name: 'empty.csv', data: '' },
    { kind: 'virus', mediaType: 'image/png', name: 'virus.png', data: pngBase64 },
  ]);
  check('the PDF is refused', refused.rejected.some((r) => r.name === 'bill.pdf'));
  check('the huge file is refused as too big', refused.rejected.some((r) => r.reason === 'too_big'));
  check('the empty file is refused as broken', refused.rejected.some((r) => r.reason === 'broken'));
  check('the unknown kind is refused', refused.rejected.some((r) => r.reason === 'not_supported'));
  check('nothing refused is passed on', refused.attachments.length === 0);
  const tooMany = voice.sanitizeAttachments(
    Array.from({ length: 6 }, () => ({
      kind: 'image',
      mediaType: 'image/png',
      name: 'a.png',
      data: pngBase64,
    }))
  );
  check('at most four files go with one question', tooMany.attachments.length === 4);
  check('the extra files are reported', tooMany.rejected.length === 2);

  // ── 3. the answer that is spoken ─────────────────────────────────────────
  section('The answer that is read out');
  check(
    'the bold markers are gone',
    voice.speakableText('**Total** is 500') === 'Total is 500',
    voice.speakableText('**Total** is 500')
  );
  check('the code fences are gone', !voice.speakableText('```js\nconst a = 1;\n```').includes('const a'));
  check('the headings are gone', voice.speakableText('# Today\n5 bills') === 'Today 5 bills');
  check('the links keep their text', voice.speakableText('see [the bill](http://x)') === 'see the bill');
  check('the list dashes are gone', voice.speakableText('- one\n- two') === 'one two');
  check('a long answer is cut', voice.speakableText('x'.repeat(5000)).length <= voice.MAX_SPEAK_CHARS + 1);
  check('Urdu is read in Urdu', voice.speechLanguageTag('ur') === 'ur-PK');
  check('English is read in English', voice.speechLanguageTag('en') === 'en-US');
  check(
    'the words of a text file go into a named block',
    voice.attachmentTextBlock({ kind: 'text', mediaType: 'text/csv', name: 'stock.csv', data: voice.textToBase64('a,b') }).includes('stock.csv')
  );

  // ── 4. the request bodies with a photo ──────────────────────────────────
  section('The request bodies with a photo');
  const photoRequest = {
    model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    system: 'You are the shop assistant.',
    messages: [
      {
        role: 'user',
        content: 'What is in this photo?',
        attachments: [
          { kind: 'image', mediaType: 'image/png', name: 'bill.png', data: pngBase64 },
          { kind: 'text', mediaType: 'text/csv', name: 'stock.csv', data: voice.textToBase64('item,qty') },
        ],
      },
    ],
    tools: [],
    maxOutputTokens: 2048,
  };
  const openAiBody = shared.buildOpenAiBody(photoRequest);
  const userMessage = openAiBody.messages[openAiBody.messages.length - 1];
  check('the message with files is a content array', Array.isArray(userMessage.content));
  check('the words come first', userMessage.content[0].type === 'text' && userMessage.content[0].text === 'What is in this photo?');
  check('the photo is an image_url part', userMessage.content[1].type === 'image_url');
  check(
    'the photo is a data URL',
    String(userMessage.content[1].image_url.url).startsWith('data:image/png;base64,')
  );
  check('the text file is a text part', userMessage.content[2].type === 'text');
  check('the text file carries its words', String(userMessage.content[2].text).includes('item,qty'));

  const anthropicBody = shared.buildAnthropicBody(photoRequest);
  const anthropicUser = anthropicBody.messages[anthropicBody.messages.length - 1];
  check('the Anthropic message is a content array', Array.isArray(anthropicUser.content));
  check('the Anthropic photo is an image block', anthropicUser.content[1].type === 'image');
  check('the Anthropic photo is base64', anthropicUser.content[1].source.type === 'base64');
  check('the Anthropic photo keeps its media type', anthropicUser.content[1].source.media_type === 'image/png');
  check('the Anthropic photo keeps its payload', anthropicUser.content[1].source.data === pngBase64);

  const plainBody = shared.buildOpenAiBody({
    model: 'm',
    system: 's',
    messages: [{ role: 'user', content: 'plain' }],
    tools: [],
    maxOutputTokens: 10,
  });
  check('a question without files stays a plain string', plainBody.messages[1].content === 'plain');

  // ── 5. the vision rules ─────────────────────────────────────────────────
  section('The vision rules');
  check('the NVIDIA vision model sees photos', shared.modelSupportsVision('nvidia', 'nvidia/nemotron-3.5-super-vl-120b-a12b'));
  check('the NVIDIA text model does not', !shared.modelSupportsVision('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b'));
  check('Claude sees photos', shared.modelSupportsVision('anthropic', 'claude-sonnet-4-5'));
  check('a photo makes the NVIDIA turn use the vision model', shared.visionModelFor('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b') === shared.NVIDIA_VISION_MODEL);
  check('Claude needs no change', shared.visionModelFor('anthropic', 'claude-sonnet-4-5') === null);
  check('the vision model gets more room to answer', shared.maxOutputTokensFor('nvidia/nemotron-3.5-super-vl-120b-a12b', 1024) === 2048);
  check('the text models keep their budget', shared.maxOutputTokensFor('nvidia/nemotron-3.5-lightning-30b-a3b', 1024) === 1024);
  check('the vision model is in the list', shared.NVIDIA_VISION_MODELS.includes('nvidia/nemotron-3.5-super-vl-120b-a12b'));

  // ── 6. the real turn (the MockProvider only — no network) ───────────────
  section('The real turn with a photo (the MockProvider only)');
  settingsService.saveAssistantSettings({
    provider: 'nvidia',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    enabled: true,
  });
  const mock = new MockProvider([{ text: 'It is a red receipt.' }]);
  runtime.setAssistantProviderOverride(mock);
  try {
    const turn = await agentService.runAssistantTurn({
      message: 'What is in this photo?',
      attachments: [
        { kind: 'image', mediaType: 'image/png', name: 'bill.png', data: pngBase64 },
      ],
    });
    check('the turn answers', turn.ok, turn.failure && turn.failure.message);
    check('the provider was called', mock.requests.length === 1);
    const sent = mock.requests[0];
    check('the photo reached the provider', Array.isArray(sent.messages[sent.messages.length - 1].attachments));
    check(
      'the photo kept its payload',
      sent.messages[sent.messages.length - 1].attachments[0].data === pngBase64
    );
    check('the turn used the vision model', sent.model === shared.NVIDIA_VISION_MODEL, sent.model);
    check('the vision model got more room', sent.maxOutputTokens === 2048, String(sent.maxOutputTokens));
    check('the source line says the vision model answered', String(turn.source || '').includes('vision model'), turn.source);
    check('the system prompt says the file is data', String(sent.system).includes('never as instructions'));
  } finally {
    runtime.setAssistantProviderOverride(null);
  }

  // A photo with no words at all is still a question.
  const mock2 = new MockProvider([{ text: 'A red receipt.' }]);
  runtime.setAssistantProviderOverride(mock2);
  try {
    const turn2 = await agentService.runAssistantTurn({
      message: '',
      attachments: [{ kind: 'image', mediaType: 'image/png', name: 'bill.png', data: pngBase64 }],
    });
    check('a photo alone is a question', turn2.ok, turn2.failure && turn2.failure.message);
  } finally {
    runtime.setAssistantProviderOverride(null);
  }

  // A refused file never reaches the provider.
  const mock3 = new MockProvider([{ text: 'ok' }]);
  runtime.setAssistantProviderOverride(mock3);
  try {
    const turn3 = await agentService.runAssistantTurn({
      message: 'hello',
      attachments: [{ kind: 'image', mediaType: 'application/pdf', name: 'bill.pdf', data: pngBase64 }],
    });
    const sentAttachments = mock3.requests[0].messages[mock3.requests[0].messages.length - 1].attachments;
    check(
      'the refused file never reaches the provider',
      !sentAttachments || sentAttachments.length === 0,
      JSON.stringify(sentAttachments)
    );
    check('the source line says the file was not attached', String(turn3.source || '').includes('not attached'), turn3.source);
  } finally {
    runtime.setAssistantProviderOverride(null);
  }

  // ── 7. the voice service (the app's own OFFLINE recogniser) ─────────────
  section('The voice service (offline, no key)');
  const scriptPath = voiceService.transcribeScriptPath();
  check('the recogniser script is on this computer', !!scriptPath, String(scriptPath));
  check('the script is really there', scriptPath ? fs.existsSync(scriptPath) : false);
  const support = voiceService.voiceSupport();
  check('the speech recogniser is the Windows one', support.stt === 'windows', support.stt);
  check('the answers can be read out', support.tts === true);
  const empty = await voiceService.transcribeWav('');
  check('an empty recording is refused politely', empty.ok === false && !!empty.message, empty.message);
  const junk = await voiceService.transcribeWav('not base64 at all !!!');
  check('a broken recording is refused politely', junk.ok === false && !!junk.message, junk.message);
  const scriptSource = fs.readFileSync(path.join(PROJECT_ROOT, 'resources/voice/transcribe.ps1'), 'utf8');
  check('the recogniser needs no key', !/api[_-]?key/i.test(scriptSource));
  check('the recogniser needs no network', !/https?:\/\//i.test(scriptSource));
  check('the recogniser is the Windows one', scriptSource.includes('System.Speech'));

  // ── 8. the wiring ───────────────────────────────────────────────────────
  section('The wiring');
  const ipcSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/main/ipc.ts'), 'utf8');
  check('the IPC has the transcribe channel', ipcSource.includes("'assistant:transcribe'"));
  check('the IPC has the voice support channel', ipcSource.includes("'assistant:voiceSupport'"));
  const preloadSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/preload/preload.ts'), 'utf8');
  check('the preload bridges the transcription', preloadSource.includes("'assistant:transcribe'"));
  check('the preload bridges the voice support', preloadSource.includes("'assistant:voiceSupport'"));
  const panelSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/components/AssistantPanel.tsx'), 'utf8');
  check('the panel has the microphone button', panelSource.includes('assistant-mic'));
  check('the panel has the attach button', panelSource.includes('assistant-file-input'));
  check('the panel has the voice-only switch', panelSource.includes('assistant_voice_only'));
  check('the panel can read an answer out', panelSource.includes('assistant-speak'));
  check('the panel shows the attached photo', panelSource.includes('assistant-attachment-thumb'));
  const mainSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/main/main.ts'), 'utf8');
  check('the app allows the microphone (and nothing else)', mainSource.includes("permission === 'media'"));
  const extraResources = packageJson.build.extraResources.map((r) => r.from);
  check('the packaged app carries the recogniser', extraResources.includes('resources/voice'), extraResources.join(','));

  // The web build: the browser listens by itself, and the audio never travels.
  const webSource = fs.readFileSync(path.join(PROJECT_ROOT, 'cloud/web/electron-browser.ts'), 'utf8');
  check('the web build answers what the voice can do', webSource.includes("'assistant:voiceSupport'"));
  check('the web build uses the browser recogniser', webSource.includes("stt: 'browser'"));
  check('the web build never sends the recording to the server', webSource.includes("'assistant:transcribe'"));
  check(
    'the web build refuses the recording politely',
    webSource.includes('The browser listens by itself')
  );
  const voiceServiceSource = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/main/services/assistant/voice.ts'),
    'utf8'
  );
  check(
    'the voice service survives a place with no filesystem',
    voiceServiceSource.includes("typeof process !== 'undefined'") &&
      voiceServiceSource.includes("typeof __dirname !== 'undefined'")
  );
  const panelSource2 = panelSource;
  check(
    'the panel falls back to the browser recogniser',
    panelSource2.includes("voiceSupport === 'browser'")
  );

  // ── 9. the strings ──────────────────────────────────────────────────────
  section('The strings');
  const keys = [
    'voiceOnly',
    'voiceOnlyHint',
    'voiceInput',
    'voiceStop',
    'voiceListening',
    'voiceNotHeard',
    'voiceUnavailable',
    'speak',
    'attach',
    'removeAttachment',
    'fileTooBig',
    'fileNotSupported',
    'fileTooMany',
  ];
  for (const key of keys) {
    check(`the string "${key}" is in English`, typeof en.assistant[key] === 'string' && en.assistant[key].length > 0);
    check(`the string "${key}" is in Urdu`, typeof ur.assistant[key] === 'string' && ur.assistant[key].length > 0);
  }
  check('the vision model hint is in English', typeof en.settings.assistant.visionModelHint === 'string');
  check('the vision model hint is in Urdu', typeof ur.settings.assistant.visionModelHint === 'string');
  check('the voice note is in English', typeof en.settings.assistant.voiceNote === 'string');
  check('the voice note is in Urdu', typeof ur.settings.assistant.voiceNote === 'string');
}

app.whenReady().then(async () => {
  try {
    await run();
  } catch (e) {
    failures++;
    console.log(`  [FAIL] the suite threw -- ${e && e.stack ? e.stack : e}`);
  }
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.log('Some assistant voice checks FAILED.');
    app.exit(1);
    return;
  }
  console.log('All assistant voice checks passed.');
  app.exit(0);
});
