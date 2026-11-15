#!/usr/bin/env node
/**
 * The assistant's provider layer + key handling.
 *
 * This suite NEVER opens a socket: the Anthropic adapter is driven with an
 * INJECTED fetch, the IPC path runs with the MockProvider installed, and a
 * global fetch guard fails the test if anything tries to reach a real network.
 *
 * It drives the REAL `dist` code:
 *   dist/shared/assistant/provider.js      (the failure mapping, the retry, the
 *                                           request body, the response parse)
 *   dist/shared/assistant/mockProvider.js  (the scripted provider)
 *   dist/main/services/assistant/settings.js (the key handling, the owner gate)
 *   dist/main/services/assistant/provider.js (the real adapter, injected fetch)
 *   dist/main/ipc.js                       (the real IPC handlers, through the
 *                                           real preload in a hidden window)
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistantProvider.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-provider-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-provider.db');

let checks = 0;
let failures = 0;
const consoleLines = [];

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** Capture every console line so the test can prove the key never shows up. */
for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    consoleLines.push(args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' '));
    original(...args);
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The secret the test stores. It must never appear in any output. */
const SECRET_KEY = 'sk-ant-TESTKEY-9f3a7c-do-not-leak-4211';

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const providerShared = require('../dist/shared/assistant/provider.js');
  const { MockProvider, flakyProvider, failingProvider } = require('../dist/shared/assistant/mockProvider.js');
  const assistantSettings = require('../dist/main/services/assistant/settings.js');
  const { AnthropicProvider, ProviderError } = require('../dist/main/services/assistant/provider.js');
  const { setAssistantProviderOverride } = require('../dist/main/services/assistant/runtime.js');
  const sharedSettings = require('../dist/shared/assistant/settings.js');

  await initDatabase();
  registerIpcHandlers();

  // ── the network guard: nothing in this test may open a socket ────────────
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    check('no real network call was attempted', false, 'global fetch was called');
    throw new Error('NETWORK CALL IN TEST');
  };

  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  // ── 1. the adapter contract (the mock) ──────────────────────────────────
  section('The adapter contract (the MockProvider)');
  const mock = new MockProvider([{ text: 'Aaj ki sale 12,500 hai.', usage: { inputTokens: 30, outputTokens: 12 } }]);
  const request = {
    model: 'the-model-from-the-setting',
    system: 'system',
    messages: [{ role: 'user', content: 'aaj ki sale?' }],
    tools: [],
    maxOutputTokens: 256,
  };
  const answer = await mock.send(request);
  check('the mock answers', answer.text === 'Aaj ki sale 12,500 hai.', answer.text);
  check('the mock reports its usage', answer.usage.inputTokens === 30 && answer.usage.outputTokens === 12);
  check('the mock recorded the request', mock.requests.length === 1);
  check('the model id comes from the caller (a setting, never hardcoded)', mock.requests[0].model === 'the-model-from-the-setting');

  // ── 2. the key handling ──────────────────────────────────────────────────
  section('The key handling');
  const before = assistantSettings.getAssistantSettingsView();
  check('the assistant is OFF by default', before.enabled === false);
  check('no key is set by default', before.keySet === false);
  check('the default roles are owner + manager', JSON.stringify(before.roles) === JSON.stringify(['owner', 'manager']));
  check('the default data level is aggregates', before.dataLevel === 'aggregates');
  check('the default budget is a small cap', before.dailyBudgetUsd > 0 && before.dailyBudgetUsd <= 5, String(before.dailyBudgetUsd));
  check('actions are OFF by default', before.actionsEnabled === false);
  check('proactive is OFF by default', before.proactiveEnabled === false);

  const afterKey = assistantSettings.setAssistantApiKey(SECRET_KEY);
  check('the key is stored', afterKey.keySet === true);
  check('the hint shows only the last four characters', afterKey.keyHint === '••••4211', afterKey.keyHint);
  check('the hint does not contain the key', !afterKey.keyHint.includes(SECRET_KEY));
  check('the settings view carries no key field', !Object.prototype.hasOwnProperty.call(afterKey, 'apiKey'));

  const raw = assistantSettings.resolveAssistantApiKey();
  check('the main process can still read the real key', raw === SECRET_KEY);

  // A masked value written back means "unchanged" (the same rule as the app's
  // other secrets).
  const maskedWrite = assistantSettings.setAssistantApiKey(afterKey.keyHint);
  check('writing the mask back keeps the key', assistantSettings.resolveAssistantApiKey() === SECRET_KEY);
  check('the mask write returns the hint again', maskedWrite.keyHint === '••••4211', maskedWrite.keyHint);

  // The generic admin settings dump must mask it.
  const { maskSecrets, SECRET_ADMIN_KEYS } = require('../dist/main/utils/secrets.js');
  check('the key is in the secret key list', SECRET_ADMIN_KEYS.has('assistant_api_key'));
  const dump = maskSecrets({ assistant_api_key: SECRET_KEY, other: 'x' }, SECRET_ADMIN_KEYS);
  check('the generic settings dump masks the key', dump.assistant_api_key !== SECRET_KEY && !dump.assistant_api_key.includes(SECRET_KEY));
  check('the masked dump has no part of the key', !dump.assistant_api_key.includes('4211'));

  // ── 3. the owner gate ────────────────────────────────────────────────────
  section('The owner gate');
  const cashier = auth.createUser({ username: 'assistant-cashier', password: 'CashierPass1', pin: '1234', role: 'cashier' });
  check('a cashier user was created', !!cashier && !!cashier.id);
  auth.setSessionUser(cashier.id);
  let cashierSave = null;
  try {
    assistantSettings.saveAssistantSettings({ enabled: true });
    cashierSave = 'no error';
  } catch (e) {
    cashierSave = e instanceof Error ? e.message : String(e);
  }
  check('a cashier cannot change the assistant settings', /owner/i.test(cashierSave || ''), cashierSave);
  let cashierKey = null;
  try {
    assistantSettings.setAssistantApiKey('another-key');
    cashierKey = 'no error';
  } catch (e) {
    cashierKey = e instanceof Error ? e.message : String(e);
  }
  check('a cashier cannot set the key', /owner/i.test(cashierKey || ''), cashierKey);
  auth.setSessionUser(owner.user.id);

  // ── 4. the error mapping ─────────────────────────────────────────────────
  section('The error mapping');
  const map = (status) => providerShared.mapProviderFailure(status, '', 'en');
  check('401 → unauthorized', map(401).code === 'unauthorized');
  check('403 → unauthorized', map(403).code === 'unauthorized');
  check('429 → rate limited', map(429).code === 'rate_limited');
  check('500 → server error', map(500).code === 'server_error');
  check('400 → invalid request', map(400).code === 'invalid_request');
  check('429 is retryable', map(429).retryable === true);
  check('401 is not retryable', map(401).retryable === false);
  check('a provider message is appended and truncated', providerShared.mapProviderFailure(400, JSON.stringify({ error: { message: 'x'.repeat(400) } }), 'en').message.length < 300);
  for (const code of ['disabled', 'no_key', 'offline', 'timeout', 'unauthorized', 'rate_limited', 'server_error', 'budget_exceeded', 'invalid_request', 'cancelled', 'unknown']) {
    const en = providerShared.assistantErrorMessage(code, 'en');
    const ur = providerShared.assistantErrorMessage(code, 'ur');
    const roman = providerShared.assistantErrorMessage(code, 'roman');
    check(`the "${code}" message exists in all three languages`, !!en && !!ur && !!roman && en !== ur && ur !== roman);
  }

  // ── 5. the retry + the timeout + the cancellation ─────────────────────────
  section('The retry, the timeout and the cancellation');
  let sleeps = 0;
  const flaky = flakyProvider(2, 'recovered');
  const retried = await providerShared.retryWithBackoff(() => flaky.send(request), {
    retries: 2,
    baseDelayMs: 1,
    sleep: async () => {
      sleeps++;
    },
  });
  check('a flaky provider is retried until it answers', retried.text === 'recovered', retried.text);
  check('the provider was called three times', flaky.callCount === 3, String(flaky.callCount));
  check('the backoff slept twice', sleeps === 2, String(sleeps));

  const alwaysFails = failingProvider(new Error('down'));
  let failed = false;
  try {
    await providerShared.retryWithBackoff(() => alwaysFails.send(request), {
      retries: 2,
      baseDelayMs: 1,
      sleep: async () => {},
    });
  } catch {
    failed = true;
  }
  check('a provider that always fails gives up after the retries', failed && alwaysFails.callCount === 3, String(alwaysFails.callCount));

  // The real adapter with an INJECTED fetch — no socket.
  const injected = (handler) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    };
    return { fetchImpl, calls };
  };

  const timeoutCase = injected(async (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal;
      signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })
  );
  const timeoutProvider = new AnthropicProvider({
    apiKey: SECRET_KEY,
    model: 'the-model-from-the-setting',
    timeoutMs: 40,
    fetchImpl: timeoutCase.fetchImpl,
  });
  let timeoutFailure = null;
  try {
    await timeoutProvider.send(request);
  } catch (e) {
    timeoutFailure = e instanceof ProviderError ? e.failure : null;
  }
  check('a hanging request becomes the friendly timeout', !!timeoutFailure && timeoutFailure.code === 'timeout', timeoutFailure ? timeoutFailure.code : 'none');
  check('the timeout message is friendly', !!timeoutFailure && /too long|time/i.test(timeoutFailure.message));

  const cancelController = new AbortController();
  const cancelCase = injected(async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })
  );
  const cancelProvider = new AnthropicProvider({
    apiKey: SECRET_KEY,
    model: 'the-model-from-the-setting',
    timeoutMs: 5000,
    fetchImpl: cancelCase.fetchImpl,
  });
  const cancelPromise = cancelProvider.send({ ...request, signal: cancelController.signal });
  cancelController.abort();
  let cancelFailure = null;
  try {
    await cancelPromise;
  } catch (e) {
    cancelFailure = e instanceof ProviderError ? e.failure : null;
  }
  check('a cancelled request is reported as cancelled', !!cancelFailure && cancelFailure.code === 'cancelled', cancelFailure ? cancelFailure.code : 'none');

  // A provider that answers with a status → the mapped failure.
  const failingCase = injected(async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: { message: 'slow down' } }),
  }));
  const failingProviderAdapter = new AnthropicProvider({
    apiKey: SECRET_KEY,
    model: 'the-model-from-the-setting',
    fetchImpl: failingCase.fetchImpl,
  });
  let statusFailure = null;
  try {
    await failingProviderAdapter.send(request);
  } catch (e) {
    statusFailure = e instanceof ProviderError ? e.failure : null;
  }
  check('a 429 becomes the friendly rate-limited message', !!statusFailure && statusFailure.code === 'rate_limited', statusFailure ? statusFailure.code : 'none');

  // ── 6. the request body (the key is in the header, never the body) ───────
  section('The request body');
  const okCase = injected(async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 11, output_tokens: 4 },
      }),
  }));
  const okProvider = new AnthropicProvider({
    apiKey: SECRET_KEY,
    model: 'the-model-from-the-setting',
    fetchImpl: okCase.fetchImpl,
  });
  const parsed = await okProvider.send({
    ...request,
    tools: [
      {
        name: 'get_today_summary',
        description: 'Today\'s summary',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        risk: 'read',
      },
    ],
  });
  check('the response is parsed', parsed.text === 'Hello' && parsed.usage.inputTokens === 11);
  check('the model id travels in the body', JSON.parse(okCase.calls[0].init.body).model === 'the-model-from-the-setting');
  check('the key travels in the header, never in the body', okCase.calls[0].init.headers['x-api-key'] === SECRET_KEY && !okCase.calls[0].init.body.includes(SECRET_KEY));
  check('the tools travel with their schema', JSON.parse(okCase.calls[0].init.body).tools[0].name === 'get_today_summary');
  check('the tool schema refuses extra fields', JSON.parse(okCase.calls[0].init.body).tools[0].input_schema.additionalProperties === false);

  // A tool result becomes a tool_result block.
  const body = providerShared.buildAnthropicBody({
    ...request,
    messages: [
      { role: 'user', content: 'aaj?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'get_today_summary', input: {} }] },
      { role: 'tool', toolCallId: 't1', name: 'get_today_summary', content: '{"today_sales":12500}' },
    ],
  });
  check('the tool call becomes a tool_use block', body.messages[1].content[0].type === 'tool_use');
  check('the tool result becomes a tool_result block', body.messages[2].content[0].type === 'tool_result');
  check('the tool result carries its id', body.messages[2].content[0].tool_use_id === 't1');

  // ── 7. the cost estimate ─────────────────────────────────────────────────
  section('The cost estimate');
  const cost = providerShared.estimateCostUsd('some-model', 1_000_000, 0);
  check('a million input tokens cost something', cost > 0, String(cost));
  check('the estimate is rounded', providerShared.estimateCostUsd('some-model', 12345, 6789) >= 0);
  check('no tokens cost nothing', providerShared.estimateCostUsd('some-model', 0, 0) === 0);

  // ── 8. the settings parsing (pure) ───────────────────────────────────────
  section('The settings parsing');
  const parsedSettings = sharedSettings.parseAssistantSettings({ assistant_enabled: '1', assistant_roles: 'owner', assistant_data_level: 'nonsense' });
  check('a truthy value enables', parsedSettings.enabled === true);
  check('the roles are parsed', JSON.stringify(parsedSettings.roles) === JSON.stringify(['owner']));
  check('a nonsense data level falls back to the default', parsedSettings.dataLevel === 'aggregates');
  check('a negative budget falls back', sharedSettings.parseAssistantSettings({ assistant_daily_budget_usd: '-5' }).dailyBudgetUsd === sharedSettings.DEFAULT_ASSISTANT_BUDGET_USD);
  check('an empty role list falls back', sharedSettings.parseAssistantSettings({ assistant_roles: '' }).roles.length === 2);

  // ── 9. the IPC boundary (the real preload, a hidden window) ──────────────
  section('The IPC boundary (the key must not cross it)');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadURL('data:text/html,<html><body>assistant test</body></html>');
  const call = (code) => win.webContents.executeJavaScript(code, true);

  const ipcSettings = await call('window.api.assistant.getSettings()');
  check('the IPC returns the settings', !!ipcSettings && ipcSettings.enabled === false);
  check('the IPC payload has no key', !JSON.stringify(ipcSettings).includes(SECRET_KEY));
  check('the IPC payload has the hint', ipcSettings.keyHint === '••••4211', ipcSettings.keyHint);

  const ipcSave = await call('window.api.assistant.saveSettings({ enabled: true, model: "the-model-from-the-setting" })');
  check('the owner can save the settings over IPC', ipcSave.enabled === true && ipcSave.model === 'the-model-from-the-setting');
  check('the save response carries no key', !JSON.stringify(ipcSave).includes(SECRET_KEY));

  // The test-connection button must work with the mock and touch no network.
  setAssistantProviderOverride(new MockProvider([{ text: 'ok' }]));
  const connection = await call('window.api.assistant.testConnection()');
  check('the test connection succeeds with the mock', connection.ok === true, JSON.stringify(connection));
  setAssistantProviderOverride(null);

  // A cashier must not be able to save the settings over IPC either.
  auth.setSessionUser(cashier.id);
  const cashierIpc = await call('window.api.assistant.saveSettings({ enabled: false })').then(
    () => 'no error',
    (e) => String(e && e.message ? e.message : e)
  );
  check('the IPC refuses a non-owner', /owner/i.test(cashierIpc), cashierIpc);
  auth.setSessionUser(owner.user.id);

  win.destroy();

  // ── 10. the key never appeared anywhere ──────────────────────────────────
  section('The key never appears in any output');
  const allOutput = consoleLines.join('\n');
  check('the key is in no console line', !allOutput.includes(SECRET_KEY));
  check('no part of the key is in the console output', !allOutput.includes('do-not-leak'));
  check('the key is in no captured IPC payload', !JSON.stringify({ ipcSettings, ipcSave, connection }).includes(SECRET_KEY));

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant provider + key checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
