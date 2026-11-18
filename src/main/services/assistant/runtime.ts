/**
 * The assistant's runtime — the one place that decides WHICH provider adapter
 * a turn uses.
 *
 * The default is the real Anthropic adapter (the key stays in the main
 * process). A test can install the MockProvider with
 * `setAssistantProviderOverride()`, so the whole plumbing — the settings, the
 * IPC, the error mapping — can be exercised WITHOUT a network.
 */
import type { AssistantLanguage, AssistantProvider, ProviderAdapter } from '../../../shared/assistant/types';
import { ASSISTANT_DEFAULT_MODEL, isAutoModel } from '../../../shared/assistant/modelRouter';
import { createAssistantProvider, ProviderError } from './provider';
import { getAssistantSettings, resolveAssistantApiKey } from './settings';

let providerOverride: ProviderAdapter | null = null;

/** Install a provider (the tests use the MockProvider). Pass null to restore. */
export function setAssistantProviderOverride(provider: ProviderAdapter | null): void {
  providerOverride = provider;
}

/** The provider override, if one is installed. */
export function getAssistantProviderOverride(): ProviderAdapter | null {
  return providerOverride;
}

/**
 * Build the provider for the shop's current settings.
 *
 * The model id AND the provider come from SETTINGS — there is no provider name
 * anywhere in the code, so the owner can switch between Anthropic and NVIDIA
 * without a rebuild.
 */
export function createProviderForSettings(
  options: {
    timeoutMs?: number;
    language?: AssistantLanguage;
    fetchImpl?: typeof fetch;
    /**
     * The key the SERVER holds (the web Worker passes its `ASSISTANT_API_KEY`
     * secret binding). When it is given it wins over the shop's saved key and
     * over the environment — and it still never leaves the server.
     */
    apiKey?: string;
  } = {}
): ProviderAdapter {
  if (providerOverride) return providerOverride;
  const settings = getAssistantSettings();
  const apiKey = (options.apiKey ?? '').trim() || resolveAssistantApiKey(settings.provider);
  // An `auto` (or foreign-provider) model is resolved HERE so an adapter that
  // builds its own body can never send the literal word "auto" upstream. The
  // agent passes the routed model on every request anyway; this is the safety
  // net for the callers that only build an adapter.
  const model = isAutoModel(settings.provider, settings.model)
    ? ASSISTANT_DEFAULT_MODEL[settings.provider]
    : settings.model;
  return createAssistantProvider({
    apiKey,
    model,
    provider: settings.provider,
    timeoutMs: options.timeoutMs ?? 60_000,
    language: options.language ?? (settings.language === 'auto' ? 'en' : settings.language),
    fetchImpl: options.fetchImpl,
  });
}

/**
 * The connection test.
 *
 * The desktop passes the key it holds; the web Worker passes the key it holds
 * as a secret binding. In both cases the key stays on the server — it is only
 * ever a header on the provider request.
 *
 * When no key is passed the shop's own saved key (or the provider's environment
 * variable) is used, so "Test connection" also works when the key was never
 * pasted into the app.
 */
export async function testAssistantConnection(
  apiKey: string,
  model: string,
  options: {
    timeoutMs?: number;
    language?: AssistantLanguage;
    fetchImpl?: typeof fetch;
    provider?: AssistantProvider;
  } = {}
): Promise<{ ok: boolean; message: string }> {
  const settings = getAssistantSettings();
  const provider = options.provider ?? settings.provider;
  const key = (apiKey ?? '').trim() || resolveAssistantApiKey(provider);
  const requested = (model ?? '').trim();
  // `auto` is not a model id — the connection test sends the real default.
  const modelId = !requested || isAutoModel(provider, requested)
    ? ASSISTANT_DEFAULT_MODEL[provider]
    : requested;
  if (!key) return { ok: false, message: 'Add an API key first.' };
  if (!modelId) return { ok: false, message: 'Choose a model first.' };
  const adapter = providerOverride
    ? providerOverride
    : createAssistantProvider({
        apiKey: key,
        model: modelId,
        provider,
        timeoutMs: options.timeoutMs ?? 20_000,
        language: options.language,
        fetchImpl: options.fetchImpl,
      });
  try {
    await adapter.send({
      model: modelId,
      system: 'You are a connection test. Reply with the single word: ok',
      messages: [{ role: 'user', content: 'ping' }],
      tools: [],
      maxOutputTokens: 16,
    });
    return { ok: true, message: 'Connection OK.' };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, message: e.failure.message };
    return { ok: false, message: 'Could not reach the AI provider.' };
  }
}
