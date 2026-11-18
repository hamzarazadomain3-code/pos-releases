#!/usr/bin/env node
/**
 * The AUTO MODEL router.
 *
 * The owner used to keep ONE model id in the settings. That breaks on the two
 * things a shop actually does: switching the provider (the old provider's id
 * is sent to the new one — a 400 on every turn) and asking very different
 * questions (a one-line lookup and a "why did profit fall?" analysis are not
 * the same job).
 *
 * This suite proves the whole feature against the REAL `dist` code:
 *
 *   1. the catalogue is valid and provider-specific,
 *   2. `auto` (and a foreign/empty model) is recognised,
 *   3. a task is classified (chat / lookup / action / analysis / vision),
 *   4. the router picks the matching model tier,
 *   5. a photo always reaches a model that can see it,
 *   6. the REAL turn runner sends the routed model (MockProvider only — no
 *      network, no real model, no key),
 *   7. a failed model falls back to another one and says so,
 *   8. a provider switch repairs a foreign model id in the settings,
 *   9. the settings screen and both languages carry the new strings.
 *
 * Usage (after `npm run build:main`):
 *   electron scripts/test_assistant_auto_model.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-auto-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-auto.db');

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
  const router = require('../dist/shared/assistant/modelRouter.js');
  const sharedProvider = require('../dist/shared/assistant/provider.js');
  const providerService = require('../dist/main/services/assistant/provider.js');
  const settingsService = require('../dist/main/services/assistant/settings.js');
  const sharedSettings = require('../dist/shared/assistant/settings.js');
  const agent = require('../dist/main/services/assistant/agent.js');
  const runtime = require('../dist/main/services/assistant/runtime.js');
  const { MockProvider } = require('../dist/shared/assistant/mockProvider.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');
  agent.assistantRateLimiter().reset();

  // ── 0. the migration ─────────────────────────────────────────────────────
  section('The migration (the shipped seed becomes auto)');
  const db = require('../dist/main/db.js').getDb();
  const rawModel = () => {
    const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'assistant_model'").get();
    return row ? String(row.value) : null;
  };
  check('a fresh install starts on auto', rawModel() === 'auto', String(rawModel()));
  require('../migrations/088_assistant_auto_model.js').up(db);
  check('the migration is idempotent', rawModel() === 'auto', String(rawModel()));
  check('the parsed setting is auto', settingsService.getAssistantSettings().model === 'auto');

  // ── 1. the catalogue ─────────────────────────────────────────────────────
  section('The model catalogue');
  const nvidia = router.ASSISTANT_MODEL_CATALOG.nvidia;
  const anthropic = router.ASSISTANT_MODEL_CATALOG.anthropic;
  check('NVIDIA has models', nvidia.length >= 3, String(nvidia.length));
  check('Anthropic has models', anthropic.length >= 2, String(anthropic.length));
  check(
    'the NVIDIA ids are unique',
    new Set(nvidia.map((m) => m.id)).size === nvidia.length
  );
  check(
    'the Anthropic ids are unique',
    new Set(anthropic.map((m) => m.id)).size === anthropic.length
  );
  check('NVIDIA has a vision model', nvidia.some((m) => m.tier === 'vision' && m.vision));
  check(
    'every Anthropic model can see a photo',
    anthropic.every((m) => m.vision)
  );
  check(
    'the fast model is the known NVIDIA default',
    router.ASSISTANT_DEFAULT_MODEL.nvidia === 'nvidia/nemotron-3.5-lightning-30b-a3b',
    router.ASSISTANT_DEFAULT_MODEL.nvidia
  );
  check('the Anthropic default is a Claude id', router.ASSISTANT_DEFAULT_MODEL.anthropic.startsWith('claude-'));
  for (const provider of ['nvidia', 'anthropic']) {
    check(
      `${provider}: every catalogue id fits its provider`,
      router.ASSISTANT_MODEL_CATALOG[provider].every((m) => router.modelFitsProvider(provider, m.id))
    );
  }

  // ── 2. auto detection ────────────────────────────────────────────────────
  section('When is the model auto?');
  check('an empty model is auto', router.isAutoModel('nvidia', ''));
  check('the word auto is auto', router.isAutoModel('nvidia', 'auto'));
  check('auto is case-insensitive', router.isAutoModel('anthropic', 'AUTO'));
  check('whitespace is ignored', router.isAutoModel('nvidia', '  default '));
  check(
    'a Claude id on NVIDIA is auto (the provider-switch bug)',
    router.isAutoModel('nvidia', 'claude-sonnet-4-5')
  );
  check(
    'an NVIDIA id on Anthropic is auto',
    router.isAutoModel('anthropic', 'nvidia/nemotron-3.5-lightning-30b-a3b')
  );
  check('a real NVIDIA id is pinned', !router.isAutoModel('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b'));
  check('a real Claude id is pinned', !router.isAutoModel('anthropic', 'claude-sonnet-4-5'));
  check('an org/model id fits NVIDIA', router.modelFitsProvider('nvidia', 'acme/shop-model'));
  check('a bare id does not fit NVIDIA', !router.modelFitsProvider('nvidia', 'some-model'));
  check('a Claude id fits Anthropic', router.modelFitsProvider('anthropic', 'claude-opus-4-1'));
  check('a non-Claude id does not fit Anthropic', !router.modelFitsProvider('anthropic', 'gpt-oss'));

  // ── 3. the task classification ───────────────────────────────────────────
  section('What kind of turn is this?');
  check('a greeting is chat', router.classifyAssistantTask('Hello') === 'chat');
  check('a salam is chat', router.classifyAssistantTask('Assalam o alaikum') === 'chat');
  check('a shop greeting is chat', router.classifyAssistantTask('سلام') === 'chat');
  check(
    "today's sale is a lookup",
    router.classifyAssistantTask('What is the total sale of today?') === 'lookup'
  );
  check(
    'a Roman Urdu sale question is a lookup',
    router.classifyAssistantTask('aaj ki sale kitni hai') === 'lookup'
  );
  check(
    'a why/profit question is an analysis',
    router.classifyAssistantTask('Why did profit fall this month?') === 'analysis'
  );
  check(
    'a comparison is an analysis',
    router.classifyAssistantTask('Compare this week with last week and tell me the trend.') === 'analysis'
  );
  check(
    'a Roman Urdu analysis is an analysis',
    router.classifyAssistantTask('is mahine munafa kyun kam hua') === 'analysis'
  );
  check(
    'an Urdu analysis is an analysis',
    router.classifyAssistantTask('اس مہینے منافع کیوں کم ہوا؟') === 'analysis'
  );
  check(
    'an instruction to add is an action',
    router.classifyAssistantTask('Add a customer named Ali') === 'action'
  );
  check(
    'a Roman Urdu instruction is an action',
    router.classifyAssistantTask('naya customer banao') === 'action'
  );
  check(
    'a long question is an analysis',
    router.classifyAssistantTask(
      'please look at the shop and tell me what happened with the things on the counter during the morning hours before the first customer arrived today'
    ) === 'analysis'
  );
  check(
    'a text file makes it an analysis',
    router.classifyAssistantTask('What is this?', { hasTextFile: true }) === 'analysis'
  );
  check(
    'a photo makes it a vision turn',
    router.classifyAssistantTask('What is this?', { hasPhoto: true }) === 'vision'
  );
  check('an empty question is chat', router.classifyAssistantTask('') === 'chat');
  check('the photo wins over a text file', router.classifyAssistantTask('x', { hasPhoto: true, hasTextFile: true }) === 'vision');

  // ── 4. the routing ───────────────────────────────────────────────────────
  section('The route: task -> model');
  const fast = nvidia.find((m) => m.tier === 'fast').id;
  const balanced = nvidia.find((m) => m.tier === 'balanced').id;
  const strong = nvidia.find((m) => m.tier === 'strong').id;
  const vision = nvidia.find((m) => m.tier === 'vision').id;

  const lookupRoute = router.routeAssistantModel({
    provider: 'nvidia',
    model: 'auto',
    question: 'What is the total sale of today?',
  });
  check('auto + lookup uses the fast model', lookupRoute.model === fast, lookupRoute.model);
  check('the lookup route is marked auto', lookupRoute.auto === true && lookupRoute.reason === 'auto');

  const chatRoute = router.routeAssistantModel({ provider: 'nvidia', model: 'auto', question: 'Hello' });
  check('auto + greeting uses the fast model', chatRoute.model === fast, chatRoute.model);

  const analysisRoute = router.routeAssistantModel({
    provider: 'nvidia',
    model: 'auto',
    question: 'Why did profit fall? Compare the trend.',
  });
  check('auto + analysis uses the strong model', analysisRoute.model === strong, analysisRoute.model);
  check('the analysis tier is strong', analysisRoute.tier === 'strong');

  const actionRoute = router.routeAssistantModel({
    provider: 'nvidia',
    model: 'auto',
    question: 'Add a customer named Ali',
  });
  check('auto + action uses the balanced model', actionRoute.model === balanced, actionRoute.model);

  const photoRoute = router.routeAssistantModel({
    provider: 'nvidia',
    model: 'auto',
    question: 'What is in this photo?',
    hasPhoto: true,
  });
  check('auto + photo uses the vision model', photoRoute.model === vision, photoRoute.model);
  check('the photo route says why', photoRoute.reason === 'vision' && photoRoute.tier === 'vision');

  const photoOnTextModel = router.routeAssistantModel({
    provider: 'nvidia',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    question: 'What is in this photo?',
    hasPhoto: true,
  });
  check('a photo on a text model switches to vision', photoOnTextModel.model === vision, photoOnTextModel.model);
  check('the switch is marked auto', photoOnTextModel.auto === true);

  const photoOnVisionModel = router.routeAssistantModel({
    provider: 'nvidia',
    model: vision,
    question: 'What is in this photo?',
    hasPhoto: true,
  });
  check('a photo on the vision model keeps it', photoOnVisionModel.model === vision);
  check('a pinned vision model is not re-routed', photoOnVisionModel.auto === false && photoOnVisionModel.reason === null);

  const claudePhoto = router.routeAssistantModel({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    question: 'What is in this photo?',
    hasPhoto: true,
  });
  check('Claude keeps the photo itself', claudePhoto.model === 'claude-sonnet-4-5');
  check('Claude needs no vision swap', claudePhoto.auto === false);

  const pinned = router.routeAssistantModel({
    provider: 'nvidia',
    model: strong,
    question: 'Hello',
  });
  check("a pinned model is the owner's choice", pinned.model === strong && pinned.auto === false);

  const mismatch = router.routeAssistantModel({
    provider: 'nvidia',
    model: 'claude-sonnet-4-5',
    question: 'What is the total sale of today?',
  });
  check('a foreign model is repaired', mismatch.model === fast && mismatch.auto === true);
  check('the repair says provider-mismatch', mismatch.reason === 'provider-mismatch', mismatch.reason);

  const anthropicAuto = router.routeAssistantModel({
    provider: 'anthropic',
    model: 'auto',
    question: 'What is the total sale of today?',
  });
  check('Anthropic auto + lookup uses the fast Claude', anthropicAuto.model === 'claude-haiku-4-5', anthropicAuto.model);
  const anthropicAnalysis = router.routeAssistantModel({
    provider: 'anthropic',
    model: 'auto',
    question: 'Why did profit fall?',
  });
  check(
    'Anthropic auto + analysis uses the balanced Claude',
    anthropicAnalysis.model === 'claude-sonnet-4-5',
    anthropicAnalysis.model
  );
  const anthropicPhoto = router.routeAssistantModel({
    provider: 'anthropic',
    model: 'auto',
    question: 'What is this?',
    hasPhoto: true,
  });
  check(
    'Anthropic auto + photo uses a Claude model',
    anthropicPhoto.model === 'claude-sonnet-4-5',
    anthropicPhoto.model
  );

  const chain = router.autoFallbackChain('nvidia', fast);
  check('the fallback chain is not empty', chain.length > 0, chain.join(', '));
  check('the fallback chain never repeats a model', new Set(chain).size === chain.length);
  check('the fallback chain does not retry the failed model', !chain.includes(fast));
  check('the fallback chain never uses the vision model for text', !chain.includes(vision), chain.join(', '));

  // ── 5. the failure policy ────────────────────────────────────────────────
  section('When does a failure switch models?');
  check(
    'a 404 (a retired model) is a request the model refused',
    sharedProvider.mapProviderFailure(404, 'model not found', 'en').code === 'invalid_request'
  );
  check(
    'a 404 keeps the friendly message',
    sharedProvider.mapProviderFailure(404, '', 'en').message.includes('could not understand') ||
      sharedProvider.mapProviderFailure(404, '', 'en').message.includes('request')
  );
  check('a model refusal is retried by a pinned model too', router.shouldRetryWithAnotherModel('invalid_request', false));
  check('a busy provider is retried in auto mode', router.shouldRetryWithAnotherModel('rate_limited', true));
  check('a busy provider is NOT retried for a pinned model', !router.shouldRetryWithAnotherModel('rate_limited', false));
  check('a wrong key is never retried', !router.shouldRetryWithAnotherModel('unauthorized', true));
  check('an offline turn is never retried', !router.shouldRetryWithAnotherModel('offline', true));
  check('a cancelled turn is never retried', !router.shouldRetryWithAnotherModel('cancelled', true));
  check('an exhausted budget is never retried', !router.shouldRetryWithAnotherModel('budget_exceeded', true));

  // ── 6. the real turn runner picks the routed model ───────────────────────
  section('The real turn runner (the MockProvider — no network)');
  settingsService.saveAssistantSettings({ provider: 'nvidia', model: 'auto', enabled: true });
  const seen = [];
  const mock = new MockProvider([
    {
      respond: (request) => {
        seen.push(request);
        return { text: 'The assistant is ready.', toolCalls: [], usage: { inputTokens: 5, outputTokens: 3 }, stopReason: 'end_turn' };
      },
    },
  ]);
  runtime.setAssistantProviderOverride(mock);

  const ask = (message, attachments) =>
    agent.runAssistantTurn({ message, history: [], attachments: attachments || [] });

  const simple = await ask('What is the total sale of today?');
  check('the simple turn succeeds', simple.ok, simple.failure && simple.failure.message);
  check('the simple turn sent the fast model', seen[seen.length - 1].model === fast, seen[seen.length - 1].model);
  check('the source line names the auto model', String(simple.source || '').includes('auto model: fast'), simple.source);

  const analysis = await ask('Why did profit fall? Compare the trend.');
  check('the analysis turn succeeds', analysis.ok, analysis.failure && analysis.failure.message);
  check('the analysis turn sent the strong model', seen[seen.length - 1].model === strong, seen[seen.length - 1].model);
  check('the source line says strong', String(analysis.source || '').includes('auto model: strong'), analysis.source);

  const action = await ask('Add a customer named Ali');
  check('the action turn succeeds', action.ok, action.failure && action.failure.message);
  check('the action turn sent the balanced model', seen[seen.length - 1].model === balanced, seen[seen.length - 1].model);

  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const photo = await ask('What is in this photo?', [
    { kind: 'image', mediaType: 'image/png', name: 'test.png', data: png },
  ]);
  check('the photo turn succeeds', photo.ok, photo.failure && photo.failure.message);
  check('the photo turn sent the vision model', seen[seen.length - 1].model === vision, seen[seen.length - 1].model);
  check('the photo turn got more room', seen[seen.length - 1].maxOutputTokens >= 2048, String(seen[seen.length - 1].maxOutputTokens));
  check('the photo source line says vision model', String(photo.source || '').includes('vision model'), photo.source);

  // A model saved from the OTHER provider must never be sent.
  settingsService.saveAssistantSettings({ model: 'claude-sonnet-4-5' });
  const foreign = await ask('What is the total sale of today?');
  check('a foreign saved model is repaired by the turn', foreign.ok, foreign.failure && foreign.failure.message);
  check('a foreign saved model is never sent', seen[seen.length - 1].model === fast, seen[seen.length - 1].model);

  // A photo can only be answered by a vision model. If the vision model fails,
  // retrying a TEXT model would send the same photo to a model that cannot see
  // it (the same 400 again), so the turn must stop after ONE attempt.
  const failedPhotoSeen = [];
  const failedPhotoProvider = new MockProvider([
    {
      respond: (request) => {
        failedPhotoSeen.push(request);
        throw new providerService.ProviderError(sharedProvider.assistantFailure('server_error', 'en'));
      },
    },
  ]);
  runtime.setAssistantProviderOverride(failedPhotoProvider);
  const failedPhoto = await ask('What is in this photo?', [
    { kind: 'image', mediaType: 'image/png', name: 'test.png', data: png },
  ]);
  check('a failed photo turn reports the failure', failedPhoto.ok === false);
  check(
    'a failed photo turn does NOT retry a text model',
    failedPhotoSeen.length === 1,
    failedPhotoSeen.map((r) => r.model).join(' -> ')
  );
  check('the one attempt was the vision model', failedPhotoSeen[0].model === vision, failedPhotoSeen[0].model);
  runtime.setAssistantProviderOverride(mock);

  // ── 7. the fallback ──────────────────────────────────────────────────────
  section('The fallback (the first model fails, the second answers)');
  settingsService.saveAssistantSettings({ model: 'auto' });
  const fallbackSeen = [];
  const failingFirst = new MockProvider([
    {
      respond: (request) => {
        fallbackSeen.push(request);
        if (fallbackSeen.length === 1) {
          throw new providerService.ProviderError(sharedProvider.assistantFailure('invalid_request', 'en'));
        }
        return { text: 'The fallback answered.', toolCalls: [], usage: { inputTokens: 4, outputTokens: 2 }, stopReason: 'end_turn' };
      },
    },
  ]);
  runtime.setAssistantProviderOverride(failingFirst);
  const recovered = await ask('What is the total sale of today?');
  check('the turn recovers after the first model fails', recovered.ok, recovered.failure && recovered.failure.message);
  check('the first attempt used the fast model', fallbackSeen[0].model === fast, fallbackSeen[0].model);
  check('the retry used another model', fallbackSeen.length === 2 && fallbackSeen[1].model !== fast, fallbackSeen.map((r) => r.model).join(' -> '));
  check('the retry model is the balanced one', fallbackSeen[1].model === balanced, fallbackSeen[1].model);
  check('the answer came from the fallback', recovered.text === 'The fallback answered.', recovered.text);
  check('the source line says fallback model', String(recovered.source || '').includes('fallback model'), recovered.source);
  check('both attempts are counted', recovered.usage.calls === 2, String(recovered.usage.calls));
  check(
    'the successful attempt usage is reported',
    recovered.usage.inputTokens === 4 && recovered.usage.outputTokens === 2,
    `${recovered.usage.inputTokens}/${recovered.usage.outputTokens}`
  );
  runtime.setAssistantProviderOverride(null);

  // ── 7b. the SERVER's provider wins (the web key lives on the server) ─────
  section("The server's provider (the web key belongs to the server)");
  // On the web the key is the SERVER's (one key for every shop), so the
  // provider follows the KEY and not the shop's setting. A shop left on the
  // shipped "anthropic" default used to send an NVIDIA key to Anthropic and
  // got "401 invalid x-api-key" on every turn.
  check('an NVIDIA key is NVIDIA', sharedProvider.providerForApiKey('nvapi-abcdef') === 'nvidia');
  check('an Anthropic key is Anthropic', sharedProvider.providerForApiKey('sk-ant-abcdef') === 'anthropic');
  check('the key is trimmed first', sharedProvider.providerForApiKey('  nvapi-abcdef  ') === 'nvidia');
  check('an empty key is unknown', sharedProvider.providerForApiKey('') === null);
  check('an unknown key is unknown', sharedProvider.providerForApiKey('some-other-key') === null);

  // The shop's setting says anthropic, the SERVER's key says nvidia: the turn
  // must use the server's provider AND its models.
  agent.assistantRateLimiter().reset();
  settingsService.saveAssistantSettings({ provider: 'anthropic', model: 'auto' });
  const serverSeen = [];
  const serverMock = new MockProvider([
    {
      respond: (request) => {
        serverSeen.push(request);
        return { text: 'ok', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end_turn' };
      },
    },
  ]);
  runtime.setAssistantProviderOverride(serverMock);
  const serverTurn = await agent.runAssistantTurn(
    { message: 'What is the total sale of today?', history: [], attachments: [] },
    { apiKey: 'nvapi-server-key', provider: 'nvidia' }
  );
  check('the turn succeeds with the server provider', serverTurn.ok, serverTurn.failure && serverTurn.failure.message);
  check(
    "the server's provider decides the model",
    serverSeen.length === 1 && serverSeen[0].model === fast,
    serverSeen.map((r) => r.model).join(' -> ')
  );
  // A photo must still reach a model that can SEE it, even on the web.
  const serverPhoto = await agent.runAssistantTurn(
    {
      message: 'What is in this photo?',
      history: [],
      attachments: [{ kind: 'image', mediaType: 'image/png', name: 'test.png', data: png }],
    },
    { apiKey: 'nvapi-server-key', provider: 'nvidia' }
  );
  check('the server photo turn succeeds', serverPhoto.ok, serverPhoto.failure && serverPhoto.failure.message);
  check(
    'the server photo turn sent the vision model',
    serverSeen[serverSeen.length - 1].model === vision,
    serverSeen.map((r) => r.model).join(' -> ')
  );
  check('the server photo source line says vision model', String(serverPhoto.source || '').includes('vision model'), serverPhoto.source);
  runtime.setAssistantProviderOverride(null);

  // ── 8. the provider switch repairs the setting ───────────────────────────
  section('The provider switch');
  settingsService.saveAssistantSettings({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
  check('the Claude model is saved', settingsService.getAssistantSettings().model === 'claude-sonnet-4-5');
  settingsService.saveAssistantSettings({ provider: 'nvidia' });
  check(
    'switching the provider turns the foreign model into auto',
    settingsService.getAssistantSettings().model === 'auto',
    settingsService.getAssistantSettings().model
  );
  settingsService.saveAssistantSettings({ provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' });
  settingsService.saveAssistantSettings({ provider: 'nvidia' });
  check(
    'switching to the same provider keeps a compatible model',
    settingsService.getAssistantSettings().model === 'nvidia/nemotron-3.5-lightning-30b-a3b'
  );
  settingsService.saveAssistantSettings({ provider: 'nvidia', model: 'auto' });

  // ── 9. the pure settings parser ──────────────────────────────────────────
  section('The pure settings parser');
  check(
    'an empty model parses as auto',
    sharedSettings.parseAssistantSettings({ assistant_model: '' }).model === 'auto'
  );
  check(
    'a missing model parses as auto',
    sharedSettings.parseAssistantSettings({}).model === 'auto'
  );
  check(
    'the default model is auto',
    sharedSettings.DEFAULT_ASSISTANT_SETTINGS.model === 'auto'
  );
  check(
    'a saved model still parses exactly',
    sharedSettings.parseAssistantSettings({ assistant_model: 'nvidia/nemotron-3-ultra-550b-a55b' }).model ===
      'nvidia/nemotron-3-ultra-550b-a55b'
  );
  check('a provider with auto is ready', settingsService.assistantReady().ok === true, JSON.stringify(settingsService.assistantReady()));

  // ── 10. the screen + the strings ─────────────────────────────────────────
  section('The settings screen and the two languages');
  const screen = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/pages/AdminPanel/AssistantSettings.tsx'), 'utf8');
  check('the screen imports the router', screen.includes('ASSISTANT_AUTO_MODEL') && screen.includes('ASSISTANT_MODEL_CATALOG'));
  check('the screen offers the Auto button', screen.includes("t('settings.assistant.modelAuto')"));
  check('the screen explains Auto', screen.includes("t('settings.assistant.modelAutoHint')"));
  check('the screen lists the catalogue', screen.includes('ASSISTANT_MODEL_CATALOG[settings.provider]'));
  for (const key of ['modelAuto', 'modelAutoHint', 'tier_fast', 'tier_balanced', 'tier_strong', 'tier_vision']) {
    check(`the string "${key}" is in English`, typeof en.settings.assistant[key] === 'string' && !!en.settings.assistant[key]);
    check(`the string "${key}" is in Urdu`, typeof ur.settings.assistant[key] === 'string' && !!ur.settings.assistant[key]);
  }
  const panel = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/components/AssistantPanel.tsx'), 'utf8');
  check('the panel sends what the voice heard in voice-only mode', /voiceOnly[\s\S]{0,220}send\(heard\)/.test(panel));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant auto-model checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
