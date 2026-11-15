/**
 * The assistant's runtime — the one place that decides WHICH provider adapter
 * a turn uses.
 *
 * The default is the real Anthropic adapter (the key stays in the main
 * process). A test can install the MockProvider with
 * `setAssistantProviderOverride()`, so the whole plumbing — the settings, the
 * IPC, the error mapping — can be exercised WITHOUT a network.
 */
import type { AssistantLanguage, ProviderAdapter } from '../../../shared/assistant/types';
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
 * The model id comes from the `assistant_model` SETTING — there is no model
 * name anywhere in the code, so the owner can change it without a rebuild.
 */
export function createProviderForSettings(
  options: { timeoutMs?: number; language?: AssistantLanguage; fetchImpl?: typeof fetch } = {}
): ProviderAdapter {
  if (providerOverride) return providerOverride;
  const settings = getAssistantSettings();
  return createAssistantProvider({
    apiKey: resolveAssistantApiKey(),
    model: settings.model,
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
 */
export async function testAssistantConnection(
  apiKey: string,
  model: string,
  options: { timeoutMs?: number; language?: AssistantLanguage; fetchImpl?: typeof fetch } = {}
): Promise<{ ok: boolean; message: string }> {
  if (!apiKey) return { ok: false, message: 'Add an API key first.' };
  if (!model) return { ok: false, message: 'Choose a model first.' };
  const provider = providerOverride
    ? providerOverride
    : createAssistantProvider({
        apiKey,
        model,
        timeoutMs: options.timeoutMs ?? 20_000,
        language: options.language,
        fetchImpl: options.fetchImpl,
      });
  try {
    await provider.send({
      model,
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
