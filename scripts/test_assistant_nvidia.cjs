#!/usr/bin/env node
/**
 * The NVIDIA provider (the OpenAI-compatible shape).
 *
 * NVIDIA's integrate API (build.nvidia.com) speaks the OpenAI chat-completions
 * shape, so the assistant can talk to it with the SAME agent loop, the SAME
 * tools and the SAME confirmation flow. This suite proves:
 *
 *   1. the request body is the OpenAI shape (the system prompt, the messages,
 *      the tool definitions and the tool results),
 *   2. the response is parsed into the app's own provider contract (the text,
 *      the tool calls, the finish reason, the usage),
 *   3. the real adapter talks to `/v1/chat/completions` with the key in the
 *      `Authorization: Bearer` header — and NEVER in the body,
 *   4. the failures map onto the shop's friendly messages,
 *   5. the key may live in the computer's environment variable — the renderer
 *      only ever learns the NAME of the variable and the last four characters.
 *
 * The network is NEVER touched: the fetch is injected, and the one test that
 * checks the environment uses a key the test itself made up.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistant_nvidia.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-nvidia-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-nvidia.db');

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

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const shared = require('../dist/shared/assistant/provider.js');
  const providerService = require('../dist/main/services/assistant/provider.js');
  const providerServiceRuntime = require('../dist/main/services/assistant/runtime.js');
  const settingsService = require('../dist/main/services/assistant/settings.js');
  const sharedSettings = require('../dist/shared/assistant/settings.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  // ── 1. the request body ─────────────────────────────────────────────────
  section('The OpenAI-compatible request body');
  const request = {
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    system: 'You are the shop assistant.',
    messages: [
      { role: 'user', content: 'How much did we sell today?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'today_sale', input: { branch: null } }],
      },
      { role: 'tool', toolCallId: 'call_1', name: 'today_sale', content: '{"total":12500}' },
    ],
    tools: [
      {
        name: 'today_sale',
        description: "Read today's sale total.",
        inputSchema: { type: 'object', properties: { branch: { type: 'string' } }, required: [] },
      },
    ],
    maxOutputTokens: 800,
    temperature: 0.2,
  };
  const body = shared.buildOpenAiBody(request);
  check('the model is in the body', body.model === request.model);
  check('the system prompt is the first message', body.messages[0].role === 'system');
  check('the system prompt keeps its text', body.messages[0].content === request.system);
  check('the user message is there', body.messages[1].role === 'user' && body.messages[1].content === request.message || body.messages[1].content === 'How much did we sell today?');
  check('the assistant tool call became a tool_calls array', Array.isArray(body.messages[2].tool_calls) && body.messages[2].tool_calls.length === 1);
  check('the tool call keeps its id', body.messages[2].tool_calls[0].id === 'call_1');
  check('the tool call is a function', body.messages[2].tool_calls[0].type === 'function');
  check('the tool call keeps its name', body.messages[2].tool_calls[0].function.name === 'today_sale');
  check(
    'the tool call arguments are a JSON string',
    typeof body.messages[2].tool_calls[0].function.arguments === 'string' &&
      JSON.parse(body.messages[2].tool_calls[0].function.arguments).branch === null
  );
  check('the tool result became a tool message', body.messages[3].role === 'tool');
  check('the tool message keeps the tool_call_id', body.messages[3].tool_call_id === 'call_1');
  check('the tool message keeps the tool name', body.messages[3].name === 'today_sale');
  check('the tool message keeps the result', body.messages[3].content === '{"total":12500}');
  check('the tools became function definitions', Array.isArray(body.tools) && body.tools.length === 1);
  check('the function definition has the OpenAI shape', body.tools[0].type === 'function' && !!body.tools[0].function);
  check('the function definition keeps the name', body.tools[0].function.name === 'today_sale');
  check('the function definition keeps the description', body.tools[0].function.description === "Read today's sale total.");
  check('the function parameters are a JSON schema', body.tools[0].function.parameters.type === 'object');
  check('the schema forbids extra fields', body.tools[0].function.parameters.additionalProperties === false);
  check('the max tokens are there', body.max_tokens === 800);
  check('the temperature is there', body.temperature === 0.2);
  check('the stream is off', body.stream === false);

  const empty = shared.buildOpenAiBody({ ...request, tools: [], messages: [] });
  check('no tools means no tools key', !('tools' in empty));
  check('no messages means only the system message', empty.messages.length === 1);

  // ── 2. the response ─────────────────────────────────────────────────────
  section('The OpenAI-compatible response');
  const parsed = shared.parseOpenAiBody({
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: 'Let me check.',
          tool_calls: [
            { id: 'call_9', function: { name: 'today_sale', arguments: '{"branch":"main"}' } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 40 },
  });
  check('the text is read', parsed.text === 'Let me check.');
  check('the tool call is read', parsed.toolCalls.length === 1);
  check('the tool call keeps its id', parsed.toolCalls[0].id === 'call_9');
  check('the tool call keeps its name', parsed.toolCalls[0].name === 'today_sale');
  check('the tool call arguments become an object', parsed.toolCalls[0].input.branch === 'main');
  check('the finish reason is a tool call', parsed.stopReason === 'tool_use');
  check('the usage is read', parsed.usage.inputTokens === 120 && parsed.usage.outputTokens === 40);

  const junkArgs = shared.parseOpenAiBody({
    choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'c', function: { name: 'today_sale', arguments: '{not json' } }] } }],
  });
  check('junk arguments never throw', junkArgs.toolCalls.length === 1);
  check('junk arguments become an empty input', Object.keys(junkArgs.toolCalls[0].input).length === 0);
  const noId = shared.parseOpenAiBody({
    choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'today_sale', arguments: '{}' } }] } }],
  });
  check('a tool call without an id still gets one', !!noId.toolCalls[0].id);
  check('the stop reason is end_turn', shared.parseOpenAiBody({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }).stopReason === 'end_turn');
  check('the stop reason is max_tokens', shared.parseOpenAiBody({ choices: [{ finish_reason: 'length', message: { content: 'ok' } }] }).stopReason === 'max_tokens');
  check('a body without choices is an error turn', shared.parseOpenAiBody({}).stopReason === 'error');
  check('a body without choices has no text', shared.parseOpenAiBody({}).text === '');

  // ── 3. the real adapter (the fetch is injected — no network) ───────────
  section('The real adapter (no network)');
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
    };
  };
  const adapter = providerService.createAssistantProvider({
    apiKey: 'nvapi-TEST-KEY',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    provider: 'nvidia',
    fetchImpl: fakeFetch,
  });
  check('the NVIDIA adapter is chosen', adapter.id === 'nvidia');
  const answer = await adapter.send(request);
  check('the adapter answers', answer.text === 'ok');
  check('the adapter called the chat-completions URL', calls[0].url === 'https://integrate.api.nvidia.com/v1/chat/completions', calls[0].url);
  const headers = calls[0].init.headers;
  check('the key goes in the Authorization header', headers.authorization === 'Bearer nvapi-TEST-KEY');
  check('the key is NOT in the body', !String(calls[0].init.body).includes('nvapi-TEST-KEY'));
  check('the key is NOT in the URL', !String(calls[0].url).includes('nvapi-TEST-KEY'));
  check('the content type is set', headers['content-type'] === 'application/json');

  // The Anthropic adapter is unchanged.
  const anthropicCalls = [];
  const anthropic = providerService.createAssistantProvider({
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    fetchImpl: async (url, init) => {
      anthropicCalls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }) };
    },
  });
  check('the Anthropic adapter is still chosen', anthropic.id === 'anthropic');
  await anthropic.send(request);
  check('the Anthropic URL is the messages API', anthropicCalls[0].url === 'https://api.anthropic.com/v1/messages', anthropicCalls[0].url);
  check('the Anthropic key goes in x-api-key', anthropicCalls[0].init.headers['x-api-key'] === 'sk-test');
  check('the Anthropic key is NOT in the body', !String(anthropicCalls[0].init.body).includes('sk-test'));

  // The failures.
  const failWith = async (status, body) => {
    const failing = providerService.createAssistantProvider({
      apiKey: 'k',
      model: 'm',
      provider: 'nvidia',
      fetchImpl: async () => ({ ok: false, status, text: async () => body }),
    });
    try {
      await failing.send(request);
      return null;
    } catch (e) {
      return e;
    }
  };
  const unauthorized = await failWith(401, '{"detail":"invalid key"}');
  check('a 401 is the key being refused', unauthorized && unauthorized.failure.code === 'unauthorized', unauthorized && unauthorized.failure.code);
  const rateLimited = await failWith(429, '{"detail":"slow down"}');
  check('a 429 is the provider being busy', rateLimited && rateLimited.failure.code === 'rate_limited', rateLimited && rateLimited.failure.code);
  const serverError = await failWith(503, 'busy');
  check('a 5xx is the provider breaking', serverError && serverError.failure.code === 'server_error', serverError && serverError.failure.code);
  check(
    'the failure message is the friendly one, not the provider text',
    unauthorized && unauthorized.failure.message.includes('API key'),
    unauthorized && unauthorized.failure.message
  );

  // ── 3b. the web path (the Worker holds the key) ────────────────────────
  section('The web path (the Worker holds the key)');
  settingsService.saveAssistantSettings({ provider: 'nvidia' });
  const webCalls = [];
  const webProvider = providerServiceRuntime.createProviderForSettings({
    apiKey: 'nvapi-SERVER-SIDE-TEST',
    language: 'en',
    fetchImpl: async (url, init) => {
      webCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }),
      };
    },
  });
  check('the web provider follows the shop setting', webProvider.id === 'nvidia', webProvider.id);
  await webProvider.send(request);
  check(
    'the key the Worker holds is the one used',
    webCalls[0].init.headers.authorization === 'Bearer nvapi-SERVER-SIDE-TEST'
  );
  check('the Worker-held key is NOT in the body', !String(webCalls[0].init.body).includes('nvapi-SERVER-SIDE-TEST'));
  // The web plumbing: the browser sends the turn to the secret route, the
  // Worker passes the shop's user, and the shop object runs the real turn with
  // the key it was handed (server to server).
  const shopObjectSource = fs.readFileSync(path.join(PROJECT_ROOT, 'cloud/src/shop-object.ts'), 'utf8');
  check(
    'the shop object runs the real turn with the key it was handed',
    shopObjectSource.includes('runAssistantTurn(payload, { apiKey })')
  );
  const accountsSource = fs.readFileSync(path.join(PROJECT_ROOT, 'cloud/src/accounts.ts'), 'utf8');
  check('the Worker passes the signed-in user to the shop object', accountsSource.includes('sessionUser: session.user_id'));
  const browserSource = fs.readFileSync(path.join(PROJECT_ROOT, 'cloud/web/electron-browser.ts'), 'utf8');
  check('the browser sends the turn to the secret route', browserSource.includes("webAssistant('send'"));

  // ── 4. the settings + the key in the environment ────────────────────────
  section('The provider setting and the key');
  check('the provider list has both providers', sharedSettings.ASSISTANT_PROVIDERS.join(',') === 'anthropic,nvidia');
  const parsedSettings = sharedSettings.parseAssistantSettings({ assistant_provider: 'nvidia' });
  check('the provider is read from the settings', parsedSettings.provider === 'nvidia');
  check(
    'an unknown provider falls back to the default',
    sharedSettings.parseAssistantSettings({ assistant_provider: 'wat' }).provider === 'anthropic'
  );
  check('the default provider is Anthropic', sharedSettings.DEFAULT_ASSISTANT_SETTINGS.provider === 'anthropic');

  // The environment fallback — with a key THE TEST made up.
  // The fallback follows the PROVIDER: the shop must be set up for NVIDIA
  // before the NVIDIA variable is looked at.
  settingsService.saveAssistantSettings({ provider: 'nvidia' });
  const savedEnv = process.env.NVIDIA_API_KEY;
  const savedEnv2 = process.env.NVIDIA_INFERENCE_API_KEY;
  process.env.NVIDIA_API_KEY = 'nvapi-ENVIRONMENT-TEST';
  process.env.NVIDIA_INFERENCE_API_KEY = 'nvapi-SECOND-ENV-TEST';
  try {
    check(
      'the environment key is found for NVIDIA',
      settingsService.resolveAssistantApiKey('nvidia') === 'nvapi-ENVIRONMENT-TEST'
    );
    check(
      'the Anthropic provider does not read the NVIDIA variable',
      settingsService.resolveAssistantApiKey('anthropic') === ''
    );
    const view = settingsService.getAssistantSettingsView();
    check('the view says the key came from the environment', view.keySourceLocal === 'environment', view.keySourceLocal);
    check('the view names the environment variable', view.keyEnvVar === 'NVIDIA_API_KEY', view.keyEnvVar);
    check('the view says a key is set', view.keySet === true);
    check('the view shows only the last four characters', view.keyHint === '••••TEST', view.keyHint);
    check('the view NEVER carries the key', !JSON.stringify(view).includes('nvapi-ENVIRONMENT-TEST'));
    // The assistant is OFF by default — the kill switch is checked first.
    check(
      'the assistant is off until the owner turns it on',
      settingsService.assistantReady().reason === 'disabled',
      settingsService.assistantReady().reason
    );
    settingsService.saveAssistantSettings({ enabled: true });
    check(
      'with the environment key the assistant is ready',
      settingsService.assistantReady().ok === true && settingsService.assistantReady().reason === null,
      JSON.stringify(settingsService.assistantReady())
    );
    settingsService.saveAssistantSettings({ enabled: false });

    // A saved key wins over the environment.
    settingsService.setAssistantApiKey('nvapi-SAVED-TEST');
    check('the saved key wins', settingsService.resolveAssistantApiKey('nvidia') === 'nvapi-SAVED-TEST');
    const savedView = settingsService.getAssistantSettingsView();
    check('the view says the key came from the shop', savedView.keySourceLocal === 'saved', savedView.keySourceLocal);
    check('the view NEVER carries the saved key either', !JSON.stringify(savedView).includes('nvapi-SAVED-TEST'));
    settingsService.setAssistantApiKey('');

    // The second environment variable is the fallback.
    delete process.env.NVIDIA_API_KEY;
    check(
      'the second environment variable is the fallback',
      settingsService.resolveAssistantApiKey('nvidia') === 'nvapi-SECOND-ENV-TEST'
    );
  } finally {
    if (savedEnv === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = savedEnv;
    if (savedEnv2 === undefined) delete process.env.NVIDIA_INFERENCE_API_KEY;
    else process.env.NVIDIA_INFERENCE_API_KEY = savedEnv2;
  }
  check('the environment is left as it was', process.env.NVIDIA_API_KEY === savedEnv);

  // The provider is a setting the owner may change.
  settingsService.saveAssistantSettings({ provider: 'nvidia' });
  check('the provider is saved', settingsService.getAssistantSettings().provider === 'nvidia');
  settingsService.saveAssistantSettings({ provider: 'anthropic' });
  check('the provider can be changed back', settingsService.getAssistantSettings().provider === 'anthropic');
  // ── 5. the cost ─────────────────────────────────────────────────────────
  section('The cost');
  check('an NVIDIA call is free on the free tier', shared.estimateCostUsd('nvidia/nemotron-3.5-lightning-30b-a3b', 1000, 500, 'nvidia') === 0);
  check('an Anthropic call is not free', shared.estimateCostUsd('claude-sonnet-4-5', 1000000, 0, 'anthropic') > 0);

  // ── 6. the strings ──────────────────────────────────────────────────────
  section('The strings');
  for (const key of ['provider', 'provider_anthropic', 'provider_nvidia', 'providerHint_anthropic', 'providerHint_nvidia', 'nvidiaModelsHint', 'nvidiaBudgetNote', 'keyFromEnvironment']) {
    check(`the string "${key}" is in English`, !!en.settings.assistant[key]);
    check(`the string "${key}" is in Urdu`, !!ur.settings.assistant[key]);
  }
  const placeholders = (text) => (String(text ?? '').match(/\{\{\w+\}\}/g) || []).sort().join(',');
  check(
    'the two languages use the same placeholders',
    placeholders(en.settings.assistant.keyFromEnvironment) === placeholders(ur.settings.assistant.keyFromEnvironment)
  );
  check('the verified NVIDIA models are listed', shared.NVIDIA_TOOL_MODELS.length >= 3, shared.NVIDIA_TOOL_MODELS.join(', '));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant NVIDIA checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
