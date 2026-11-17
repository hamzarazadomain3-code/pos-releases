/**
 * The real provider adapters — the Anthropic Messages API and the
 * OpenAI-compatible shape NVIDIA's integrate API speaks.
 *
 * The KEY LIVES HERE, in the main process. The renderer never sees it: it only
 * calls `assistant:send` over IPC. The key is read from the app's own secret
 * store (`admin_settings`, masked on the way out) — or, when the shop has not
 * saved one, from the provider's own environment variable — and it is NEVER
 * written into a request body, a log line or an error message.
 */
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_HOST,
  assistantFailure,
  buildAnthropicBody,
  buildOpenAiBody,
  mapProviderFailure,
  NVIDIA_DEFAULT_HOST,
  parseAnthropicBody,
  parseOpenAiBody,
  retryWithBackoff,
} from '../../../shared/assistant/provider';
import type {
  AssistantFailure,
  AssistantLanguage,
  AssistantProvider,
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from '../../../shared/assistant/types';

/** An error carrying the assistant's friendly failure (never the raw provider text). */
export class ProviderError extends Error {
  readonly failure: AssistantFailure;
  constructor(failure: AssistantFailure) {
    super(failure.message);
    this.name = 'ProviderError';
    this.failure = failure;
  }
}

export interface AnthropicProviderOptions {
  apiKey: string;
  /** The model id — it comes from the `assistant_model` SETTING. */
  model: string;
  host?: string;
  timeoutMs?: number;
  /** Injected for tests; the default is the global fetch. */
  fetchImpl?: typeof fetch;
  language?: AssistantLanguage;
}

/**
 * The Anthropic adapter.
 *
 * Timeouts: a request that hangs is aborted after `timeoutMs` and becomes the
 * friendly "timeout" message. Retries: at most two extra attempts, with a
 * backoff, and only for a retryable failure (offline / 429 / 5xx).
 */
export class AnthropicProvider implements ProviderAdapter {
  readonly id = 'anthropic';
  private readonly options: AnthropicProviderOptions;

  constructor(options: AnthropicProviderOptions) {
    this.options = options;
  }

  async send(request: ProviderRequest): Promise<ProviderResponse> {
    const language = this.options.language ?? 'en';
    const body = buildAnthropicBody({ ...request, model: request.model || this.options.model });
    const payload = JSON.stringify(body);
    const host = this.options.host ?? ANTHROPIC_DEFAULT_HOST;
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;

    const attempt = async (): Promise<ProviderResponse> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onExternalAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onExternalAbort);
      try {
        const res = await fetchImpl(`${host}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.options.apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: payload,
          signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) throw new ProviderError(mapProviderFailure(res.status, text, language));
        try {
          return parseAnthropicBody(JSON.parse(text));
        } catch {
          throw new ProviderError(assistantFailure('invalid_request', language));
        }
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        // The abort signal is how a timeout AND a user cancel arrive. The user
        // cancel is reported by the caller, so the timeout wins here.
        if (request.signal?.aborted) throw new ProviderError(assistantFailure('cancelled', language));
        const name = (e as { name?: string })?.name ?? '';
        if (name === 'AbortError') throw new ProviderError(assistantFailure('timeout', language));
        throw new ProviderError(assistantFailure('offline', language));
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onExternalAbort);
      }
    };

    return retryWithBackoff(attempt, {
      retries: 2,
      baseDelayMs: 500,
      isRetryable: (e) => {
        if (e instanceof ProviderError) return e.failure.retryable;
        return false;
      },
    });
  }
}

/**
 * The OpenAI-compatible adapter — this is what NVIDIA's integrate API speaks.
 *
 * The differences from the Anthropic adapter are small and all in the request:
 * the URL is `/v1/chat/completions`, the key goes in `Authorization: Bearer`
 * (not `x-api-key`) and the body is the chat-completions shape. The timeout,
 * the retry, the abort and the failure mapping are exactly the same, so both
 * providers behave the same way in the shop.
 */
export interface OpenAiCompatibleProviderOptions {
  apiKey: string;
  /** The model id — it comes from the `assistant_model` SETTING. */
  model: string;
  host?: string;
  timeoutMs?: number;
  /** Injected for tests; the default is the global fetch. */
  fetchImpl?: typeof fetch;
  language?: AssistantLanguage;
  /** The adapter's id ('nvidia' for the shop). */
  id?: string;
}

export class OpenAiCompatibleProvider implements ProviderAdapter {
  readonly id: string;
  private readonly options: OpenAiCompatibleProviderOptions;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.options = options;
    this.id = options.id ?? 'openai-compatible';
  }

  async send(request: ProviderRequest): Promise<ProviderResponse> {
    const language = this.options.language ?? 'en';
    const body = buildOpenAiBody({ ...request, model: request.model || this.options.model });
    const payload = JSON.stringify(body);
    const host = this.options.host ?? NVIDIA_DEFAULT_HOST;
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;

    const attempt = async (): Promise<ProviderResponse> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onExternalAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onExternalAbort);
      try {
        const res = await fetchImpl(`${host}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
          },
          body: payload,
          signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) throw new ProviderError(mapProviderFailure(res.status, text, language));
        try {
          const parsed = parseOpenAiBody(JSON.parse(text));
          // A 200 with no choice is a refusal (a model that cannot be used),
          // not an answer — the agent loop must not see an empty turn.
          if (!parsed.text && parsed.toolCalls.length === 0 && parsed.stopReason === 'error') {
            throw new ProviderError(assistantFailure('invalid_request', language));
          }
          return parsed;
        } catch (e) {
          if (e instanceof ProviderError) throw e;
          throw new ProviderError(assistantFailure('invalid_request', language));
        }
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        // The abort signal is how a timeout AND a user cancel arrive. The user
        // cancel is reported by the caller, so the timeout wins here.
        if (request.signal?.aborted) throw new ProviderError(assistantFailure('cancelled', language));
        const name = (e as { name?: string })?.name ?? '';
        if (name === 'AbortError') throw new ProviderError(assistantFailure('timeout', language));
        throw new ProviderError(assistantFailure('offline', language));
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onExternalAbort);
      }
    };

    return retryWithBackoff(attempt, {
      retries: 2,
      baseDelayMs: 500,
      isRetryable: (e) => {
        if (e instanceof ProviderError) return e.failure.retryable;
        return false;
      },
    });
  }
}

/** Build the adapter for the shop's current settings. */
export function createAssistantProvider(options: {
  apiKey: string;
  model: string;
  /** Which provider to talk to — a SETTING, not a hardcoded name. */
  provider?: AssistantProvider;
  timeoutMs?: number;
  language?: AssistantLanguage;
  fetchImpl?: typeof fetch;
}): ProviderAdapter {
  if (options.provider === 'nvidia') {
    return new OpenAiCompatibleProvider({
      apiKey: options.apiKey,
      model: options.model,
      timeoutMs: options.timeoutMs,
      language: options.language,
      fetchImpl: options.fetchImpl,
      id: 'nvidia',
    });
  }
  return new AnthropicProvider(options);
}
