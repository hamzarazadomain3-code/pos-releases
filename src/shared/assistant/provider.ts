/**
 * The provider layer — the contract, the failure mapping, the retry policy and
 * the pure parts of the Anthropic Messages API (the request body and the
 * response parse).
 *
 * NOTHING here opens a socket. The network call lives in the main process
 * (`src/main/services/assistant/provider.ts`), so a test can drive the whole
 * request/response shape without a network.
 */
import type {
  AssistantErrorCode,
  AssistantFailure,
  AssistantLanguage,
  AssistantProvider,
  AssistantToolCall,
  ProviderRequest,
  ProviderResponse,
} from './types';
import { attachmentTextBlock, type AssistantAttachment } from './voice';

/** The Anthropic Messages API version this adapter speaks. */
export const ANTHROPIC_API_VERSION = '2023-06-01';
export const ANTHROPIC_DEFAULT_HOST = 'https://api.anthropic.com';

/**
 * The OpenAI-compatible host.
 *
 * NVIDIA's integrate API (`build.nvidia.com`) speaks the OpenAI chat-completions
 * shape, so the same adapter covers it (and any other compatible endpoint).
 */
export const OPENAI_COMPATIBLE_DEFAULT_HOST = 'https://integrate.api.nvidia.com';
/** NVIDIA's own name for the same host. */
export const NVIDIA_DEFAULT_HOST = OPENAI_COMPATIBLE_DEFAULT_HOST;

/**
 * The models NVIDIA's free tier serves that can CALL THE TOOLS.
 *
 * The assistant needs tool calling — a model that cannot call a tool can only
 * chat. These three are verified to return `tool_calls` on NVIDIA's API; the
 * others in the catalogue are embedding, safety or plain-chat models.
 */
export const NVIDIA_TOOL_MODELS = [
  'openai/gpt-oss-20b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-ultra-550b-a55b',
] as const;

/** The model NVIDIA's free tier serves by default (the fastest one). */
export const NVIDIA_DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

/**
 * The NVIDIA models that can LOOK at a photo.
 *
 * The free tier serves 32 models, but only the vision-language ones read an
 * image — the text models answer `400 "multimodal processing is not enabled"`.
 * The vision model also calls the tools, so one model can do the whole job.
 */
export const NVIDIA_VISION_MODELS = [
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
] as const;

/** The model used for a question that carries a photo. */
export const NVIDIA_VISION_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

/**
 * The vision models spend a lot of their tokens THINKING before they answer,
 * so they need more room than the plain models — otherwise the answer is cut
 * off half way through the reasoning.
 */
export const VISION_OUTPUT_TOKEN_FLOOR = 2048;

/** Can this model look at a photo? */
export function modelSupportsVision(provider: AssistantProvider, model: string): boolean {
  const id = String(model || '').trim().toLowerCase();
  if (!id) return false;
  // Every Claude model the assistant can pick reads images.
  if (provider === 'anthropic') return true;
  if ((NVIDIA_VISION_MODELS as readonly string[]).includes(id)) return true;
  return /(^|[-/_])(vl|vision|llava|omni)([-/_]|$)/.test(id);
}

/**
 * The model that must be used when a photo is attached.
 *
 * `null` means "the shop's own model already sees photos" (Anthropic), so
 * nothing has to be changed.
 */
export function visionModelFor(provider: AssistantProvider, model: string): string | null {
  if (modelSupportsVision(provider, model)) return null;
  if (provider === 'anthropic') return null;
  return NVIDIA_VISION_MODEL;
}

/** The output-token budget for a model (the vision models need more room). */
export function maxOutputTokensFor(model: string, base: number): number {
  const id = String(model || '').trim().toLowerCase();
  if (id.includes('-vl-') || id.includes('vision')) return Math.max(base, VISION_OUTPUT_TOKEN_FLOOR);
  return base;
}

/**
 * The OpenAI-compatible content blocks for the files a user attached.
 *
 * A photo becomes an `image_url` part with the data URL (that is the shape
 * NVIDIA's API reads); a text file becomes a text part with its words — the
 * model then knows the file is DATA and never an instruction.
 */
export function openAiAttachmentBlocks(attachments: AssistantAttachment[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  for (const attachment of attachments ?? []) {
    if (attachment.kind === 'image') {
      blocks.push({
        type: 'image_url',
        image_url: { url: `data:${attachment.mediaType || 'image/png'};base64,${attachment.data}` },
      });
      continue;
    }
    blocks.push({ type: 'text', text: attachmentTextBlock(attachment) });
  }
  return blocks;
}

/** The Anthropic content blocks for the files a user attached. */
export function anthropicAttachmentBlocks(attachments: AssistantAttachment[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  for (const attachment of attachments ?? []) {
    if (attachment.kind === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mediaType || 'image/png',
          data: attachment.data,
        },
      });
      continue;
    }
    blocks.push({ type: 'text', text: attachmentTextBlock(attachment) });
  }
  return blocks;
}

/**
 * The OpenAI-compatible chat-completions body for one request.
 *
 * The tool definitions become `tools: [{type: 'function', function: {...}}]`,
 * the assistant's messages become the `messages` array and a `tool` message
 * carries `tool_call_id` + `name` (that is the shape this API expects).
 */
export function buildOpenAiBody(request: ProviderRequest): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [];
  if (request.system) messages.push({ role: 'system', content: request.system });
  for (const m of request.messages) {
    if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.toolCallId ?? '',
        name: m.name ?? '',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        })),
      });
      continue;
    }
    // A question with files attached carries a content ARRAY: the words first,
    // then the photo (or the file's text).
    if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: m.content }, ...openAiAttachmentBlocks(m.attachments)],
      });
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.maxOutputTokens,
    stream: false,
  };
  if (request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.inputSchema.properties,
          required: t.inputSchema.required ?? [],
          additionalProperties: false,
        },
      },
    }));
  }
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  return body;
}

/**
 * The OpenAI-compatible response, parsed into the provider contract.
 *
 * A tool call's arguments arrive as a JSON STRING — junk in that string is
 * dropped (an empty input), never thrown at the agent loop.
 */
export function parseOpenAiBody(json: unknown): ProviderResponse {
  const body = (json ?? {}) as {
    choices?: {
      message?: {
        content?: string;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
      finish_reason?: string;
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = body.choices?.[0];
  const message = choice?.message;
  const toolCalls: AssistantToolCall[] = [];
  for (const call of message?.tool_calls ?? []) {
    const name = call?.function?.name;
    if (typeof name !== 'string' || !name) continue;
    let input: Record<string, unknown> = {};
    const raw = call?.function?.arguments;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        input = {};
      }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      input = raw as Record<string, unknown>;
    }
    toolCalls.push({
      id: typeof call?.id === 'string' && call.id ? call.id : `call_${toolCalls.length + 1}`,
      name,
      input,
    });
  }
  const finish = choice?.finish_reason;
  const stopReason: ProviderResponse['stopReason'] =
    finish === 'tool_calls' || finish === 'function_call'
      ? 'tool_use'
      : finish === 'length'
        ? 'max_tokens'
        : finish === 'stop'
          ? 'end_turn'
          : 'error';
  return {
    text: typeof message?.content === 'string' ? message.content.trim() : '',
    toolCalls,
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    },
    stopReason,
  };
}

/**
 * The friendly message for every failure code, in the three languages the
 * assistant speaks. The renderer picks the language; the model never does.
 */
export const ASSISTANT_ERROR_MESSAGES: Record<AssistantErrorCode, Record<'en' | 'ur' | 'roman', string>> = {
  disabled: {
    en: 'The assistant is turned off. The owner can turn it on in Settings → Assistant.',
    ur: 'اسسٹنٹ بند ہے۔ مالک اسے سیٹنگز → اسسٹنٹ میں کھول سکتا ہے۔',
    roman: 'Assistant band hai. Owner isay Settings → Assistant mein khol sakta hai.',
  },
  no_key: {
    en: 'The assistant has no API key yet. Add one in Settings → Assistant.',
    ur: 'اسسٹنٹ کے پاس ابھی API کلید نہیں ہے۔ سیٹنگز → اسسٹنٹ میں شامل کریں۔',
    roman: 'Assistant ke paas abhi API key nahi hai. Settings → Assistant mein daal dein.',
  },
  offline: {
    en: 'No internet connection. The assistant needs a connection to answer.',
    ur: 'انٹرنیٹ کنکشن نہیں ہے۔ اسسٹنٹ کو جواب دینے کے لیے کنکشن چاہیے۔',
    roman: 'Internet nahi chal raha. Assistant ko jawab dene ke liye connection chahiye.',
  },
  timeout: {
    en: 'The assistant took too long and gave up. Please try again.',
    ur: 'اسسٹنٹ نے بہت دیر کی اور رک گیا۔ دوبارہ کوشش کریں۔',
    roman: 'Assistant ne bohat waqt lagaya aur ruk gaya. Dobara koshish karein.',
  },
  unauthorized: {
    en: 'The API key was rejected. Check the key in Settings → Assistant.',
    ur: 'API کلید کو قبول نہیں کیا گیا۔ سیٹنگز → اسسٹنٹ میں کلید دیکھیں۔',
    roman: 'API key accept nahi hui. Settings → Assistant mein key check karein.',
  },
  rate_limited: {
    en: 'The AI provider is busy right now. Please try again in a minute.',
    ur: 'AI سروس اِس وقت مصروف ہے۔ ایک منٹ بعد دوبارہ کوشش کریں۔',
    roman: 'AI service abhi busy hai. Ek minute baad dobara koshish karein.',
  },
  server_error: {
    en: 'The AI provider had a problem. Please try again.',
    ur: 'AI سروس میں مسئلہ پیش آیا۔ دوبارہ کوشش کریں۔',
    roman: 'AI service mein masla hua. Dobara koshish karein.',
  },
  budget_exceeded: {
    en: 'The assistant reached today\'s budget. Ask the owner to raise it.',
    ur: 'اسسٹنٹ آج کے بجٹ تک پہنچ گیا۔ مالک سے بجٹ بڑھانے کو کہیں۔',
    roman: 'Assistant aaj ke budget tak pohanch gaya. Owner se budget barhane ko kahein.',
  },
  invalid_request: {
    en: 'The assistant could not understand the request. Try rephrasing it.',
    ur: 'اسسٹنٹ درخواست نہیں سمجھ سکا۔ الفاظ بدل کر دوبارہ کہیں۔',
    roman: 'Assistant request samajh nahi paya. Alfaaz badal kar dobara kahein.',
  },
  cancelled: {
    en: 'Stopped.',
    ur: 'روک دیا گیا۔',
    roman: 'Rok diya gaya.',
  },
  unknown: {
    en: 'The assistant hit a problem. Please try again.',
    ur: 'اسسٹنٹ کو مسئلہ پیش آیا۔ دوبارہ کوشش کریں۔',
    roman: 'Assistant ko masla hua. Dobara koshish karein.',
  },
};

/** The message for a failure code, in the requested language. */
export function assistantErrorMessage(code: AssistantErrorCode, language: AssistantLanguage = 'en'): string {
  const row = ASSISTANT_ERROR_MESSAGES[code] ?? ASSISTANT_ERROR_MESSAGES.unknown;
  if (language === 'ur') return row.ur;
  if (language === 'roman') return row.roman;
  return row.en;
}
/** A failure object with the friendly message already in the user's language. */
export function assistantFailure(
  code: AssistantErrorCode,
  language: AssistantLanguage = 'en',
  retryable?: boolean
): AssistantFailure {
  return {
    code,
    message: assistantErrorMessage(code, language),
    retryable: retryable ?? ['offline', 'timeout', 'rate_limited', 'server_error'].includes(code),
  };
}

/**
 * Map an HTTP status + body onto the assistant's failure codes.
 *
 * 401/403 → the key is wrong; 429 → the provider is busy; 5xx → the provider
 * broke; 400 → the request was malformed (our bug, not the shop's).
 */
export function mapProviderFailure(
  status: number,
  bodyText: string,
  language: AssistantLanguage = 'en'
): AssistantFailure {
  let code: AssistantErrorCode;
  if (status === 401 || status === 403) code = 'unauthorized';
  else if (status === 429) code = 'rate_limited';
  else if (status >= 500) code = 'server_error';
  else if (status === 400 || status === 404 || status === 405 || status === 422) code = 'invalid_request';
  else if (status === 408 || status === 504) code = 'timeout';
  else code = 'unknown';
  const detail = extractProviderMessage(bodyText);
  const base = assistantFailure(code, language);
  // The provider's own message can help, but it never replaces the friendly one
  // and it is truncated so a provider cannot push a wall of text at the owner.
  if (detail) return { ...base, message: `${base.message} (${detail.slice(0, 160)})` };
  return base;
}

/** Pull the human-readable message out of a provider's error body. */
export function extractProviderMessage(bodyText: string): string {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string; message?: string };
    const err = parsed.error;
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    /* not JSON — fall through */
  }
  return '';
}

/**
 * Retry with backoff. At most `retries` extra attempts (the default is 2, so
 * three tries in total) and only for a retryable failure.
 *
 * The sleep is injected so a test never waits for real time.
 */
export async function retryWithBackoff<T>(
  attempt: (tryIndex: number) => Promise<T>,
  options: {
    retries?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    isRetryable?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 2);
  const baseDelay = Math.max(0, options.baseDelayMs ?? 500);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const isRetryable = options.isRetryable ?? (() => true);
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt(i);
    } catch (e) {
      lastError = e;
      if (i >= retries || !isRetryable(e)) throw e;
      await sleep(baseDelay * Math.pow(2, i));
    }
  }
  throw lastError;
}

/**
 * The Anthropic Messages API body for one request.
 *
 * The tool definitions become `tools: [{name, description, input_schema}]` and
 * the assistant's messages become the `messages` array (a `tool` message
 * carries `tool_use_id`).
 */
export function buildAnthropicBody(request: ProviderRequest): Record<string, unknown> {
  const messages = request.messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            is_error: false,
          },
        ],
      };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Record<string, unknown>[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      return { role: 'assistant', content: blocks };
    }
    // A question with files attached carries a content ARRAY: the words first,
    // then the photo (or the file's text).
    if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
      return {
        role: 'user',
        content: [{ type: 'text', text: m.content }, ...anthropicAttachmentBlocks(m.attachments)],
      };
    }
    return { role: m.role, content: m.content };
  });

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: request.system,
    messages,
  };
  if (request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: t.inputSchema.properties,
        required: t.inputSchema.required ?? [],
        additionalProperties: false,
      },
    }));
  }
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  return body;
}

/** The Anthropic response, parsed into the provider contract. */
export function parseAnthropicBody(json: unknown): ProviderResponse {
  const body = (json ?? {}) as {
    content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text: string[] = [];
  const toolCalls: AssistantToolCall[] = [];
  for (const block of body.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
    else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  const stop = body.stop_reason;
  const stopReason: ProviderResponse['stopReason'] =
    stop === 'tool_use' ? 'tool_use' : stop === 'max_tokens' ? 'max_tokens' : stop === 'end_turn' ? 'end_turn' : 'error';
  return {
    text: text.join('\n').trim(),
    toolCalls,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    },
    stopReason,
  };
}

/**
 * The cost estimate (USD) for a call.
 *
 * A rough table per 1M tokens; an unknown model falls back to the middle of the
 * table so the budget is never silently zero. The owner can read the estimate
 * in Settings → Assistant (Item 13).
 *
 * NVIDIA's free tier (build.nvidia.com) does NOT bill per token — the call is
 * free, so the estimate is 0 and the daily cap cannot bite. The rate limit and
 * the tool limits still do.
 */
const COST_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4': { input: 1, output: 5 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  provider: AssistantProvider = 'anthropic'
): number {
  if (provider === 'nvidia') return 0;
  const key = Object.keys(COST_PER_MTOK).find((k) => model.startsWith(k));
  const rate = key ? COST_PER_MTOK[key] : { input: 3, output: 15 };
  const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  // Round to 4 decimals so the daily total is readable.
  return Math.round(cost * 10000) / 10000;
}
