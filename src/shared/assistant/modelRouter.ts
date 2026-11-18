/**
 * The AUTO MODEL router — which model answers THIS turn.
 *
 * The shop used to name one model and every question went to it. That breaks
 * in two very common situations:
 *
 *   1. the owner switches the provider (Anthropic → NVIDIA) and the saved
 *      model id belongs to the other provider, so every turn fails;
 *   2. a photo arrives while the saved model cannot see one;
 *   3. a deep "why did profit fall?" question is sent to the smallest model,
 *      while "what is today's sale?" pays for the biggest one.
 *
 * This module is the ONE place that decides. It is pure (no network, no Node
 * builtin), so the renderer settings screen and the permanent test import the
 * same code the main process uses.
 *
 * The owner can still pin a model — a pinned model is NEVER silently changed
 * (only a photo/unknown model forces the documented fallback).
 */
import type { AssistantProvider } from './types';
import { modelSupportsVision, visionModelFor } from './provider';

/**
 * The value the shop saves to mean "choose for me".
 *
 * An EMPTY model value is treated as `auto` too: an install that cleared the
 * field (or an upgrade from a build that had no model) must keep working.
 */
export const ASSISTANT_AUTO_MODEL = 'auto';

/** What a model is good at. */
export type AssistantModelTier = 'fast' | 'balanced' | 'strong' | 'vision';

/** What the user asked, as the router sees it. */
export type AssistantTaskKind = 'vision' | 'analysis' | 'action' | 'lookup' | 'chat';

/** One model in the catalogue the settings screen shows. */
export interface AssistantModelOption {
  /** The exact model id the provider wants. */
  id: string;
  tier: AssistantModelTier;
  /** True when the model can look at a photo. */
  vision: boolean;
}

/**
 * The models verified to work with the assistant (tool calling, and the
 * vision model reading a photo). The fast/balanced/strong trio is what the
 * auto router switches between; the vision model is only for a photo.
 */
export const ASSISTANT_MODEL_CATALOG: Record<AssistantProvider, AssistantModelOption[]> = {
  anthropic: [
    { id: 'claude-haiku-4-5', tier: 'fast', vision: true },
    { id: 'claude-sonnet-4-5', tier: 'balanced', vision: true },
  ],
  nvidia: [
    { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', tier: 'fast', vision: false },
    { id: 'openai/gpt-oss-20b', tier: 'balanced', vision: false },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', tier: 'strong', vision: false },
    { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', tier: 'vision', vision: true },
  ],
};

/** The model used when nothing can be routed (never sends `auto` upstream). */
export const ASSISTANT_DEFAULT_MODEL: Record<AssistantProvider, string> = {
  anthropic: 'claude-sonnet-4-5',
  nvidia: 'nvidia/nemotron-3.5-lightning-30b-a3b',
};

/**
 * Does this model id belong to this provider?
 *
 * A Claude model id always starts with `claude`; NVIDIA's catalogue ids are
 * always `<org>/<model>`. This is what catches a provider switch that left the
 * old provider's model in the setting — the bug that made every turn fail.
 */
export function modelFitsProvider(provider: AssistantProvider, model: string): boolean {
  const id = String(model ?? '').trim().toLowerCase();
  if (!id) return true; // empty means auto, which always fits
  if (id === ASSISTANT_AUTO_MODEL || id === 'default' || id === 'automatic') return true;
  if (provider === 'anthropic') return id.startsWith('claude');
  return id.includes('/');
}

/**
 * Is the shop asking the router to choose?
 *
 * An empty/auto value AND a model that belongs to the other provider both mean
 * "choose"; the second is what repairs a switch that left a foreign id behind.
 */
export function isAutoModel(provider: AssistantProvider, model: string): boolean {
  const id = String(model ?? '').trim().toLowerCase();
  if (!id || id === ASSISTANT_AUTO_MODEL || id === 'default' || id === 'automatic') return true;
  return !modelFitsProvider(provider, id);
}

/** The analysis words — a question that needs reasoning, not a lookup. */
const ANALYSIS_PATTERN =
  /\b(analy[sz]e|analysis|analytics|compare|comparison|trend|forecast|predict|projection|why|how come|explain|breakdown|break down|summary|summari[sz]e|report|insight|recommend|suggest|advice|advise|strategy|plan|profit|loss|margin|profitable|best|worst|top|bottom|rank|increase|decrease|improve|grow|growth|decline|seasonal|pattern|anomaly)\b|(?:tajziya|tajzia|hisaab|hisab|munafa|munafaa|nuqsan|nuqsaan|muqabla|moqabla|kyun|kyon|kaisay|kaise|mashwara|salah|behtar|sab\s*se\s*(?:zyada|kam)|tafseel|tafsil|andaza|andaaza|report|riport|trend|barha|barhao|barhana|kami|izafa)|(?:تجزیہ|تجزیا|رپورٹ|موازنہ|کیوں|کیسے|خلاصہ|منافع|نقصان|حساب|مشورہ|تجویز|بہتر|سب\s*سے|تفصیل|اندازہ|اضافہ|کمی)/i;

/** The action words — the user wants a tool to change something. */
const ACTION_PATTERN =
  /\b(add|create|make|update|change|edit|set|record|enter|save|delete|remove|hold|resume|apply|assign|add karo|banao|banado|bana do|likho|likh do|badlo|badal do|hatao|nikalo|lagao|karo|kar do)\b|(?:banao|banado|bana\s*do|likho|likh\s*do|badlo|badal\s*do|hatao|nikalo|lagao|kar\s*do)|(?:بناؤ|بنائیں|لکھو|بدلو|ہٹاؤ|نکالو|لگاؤ|کرو)/i;

/** A greeting / thanks — the smallest model is plenty. */
const GREETING_PATTERN =
  /^(hi|hey|hello|salam|salaam|assalam|assalamualaikum|as-salamu|thanks|thank you|shukriya|ok|okay|help|madad)\b|^(سلام|شکریہ|مدد)/i;

/**
 * What kind of turn is this?
 *
 * A photo always wins (it needs a vision model). A text file is an analysis
 * job. A greeting is chat. A question with reasoning words is analysis, an
 * instruction to change something is an action, and everything else is a
 * plain lookup (the fastest path).
 */
export function classifyAssistantTask(
  question: string,
  options: { hasPhoto?: boolean; hasTextFile?: boolean } = {}
): AssistantTaskKind {
  if (options.hasPhoto) return 'vision';
  if (options.hasTextFile) return 'analysis';
  const text = String(question ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return 'chat';
  if (GREETING_PATTERN.test(text) && text.length <= 48) return 'chat';
  const words = text.split(' ').filter(Boolean).length;
  if (ANALYSIS_PATTERN.test(text) || words >= 18) return 'analysis';
  if (ACTION_PATTERN.test(text)) return 'action';
  return 'lookup';
}

/** The model tier a task needs. */
export function tierForTask(task: AssistantTaskKind): AssistantModelTier {
  switch (task) {
    case 'vision':
      return 'vision';
    case 'analysis':
      return 'strong';
    case 'action':
      return 'balanced';
    case 'chat':
    case 'lookup':
    default:
      return 'fast';
  }
}

/** The model of a tier for a provider. */
export function modelForTier(provider: AssistantProvider, tier: AssistantModelTier): string {
  const catalog = ASSISTANT_MODEL_CATALOG[provider] ?? ASSISTANT_MODEL_CATALOG.nvidia;
  if (tier === 'vision') {
    const vision = catalog.find((option) => option.tier === 'vision' && option.vision);
    // Anthropic has no separate vision tier — every Claude model sees, so the
    // balanced model is the right choice there.
    if (vision) return vision.id;
    return modelForTier(provider, 'balanced');
  }
  const exact = catalog.find((option) => option.tier === tier);
  if (exact) return exact.id;
  const balanced = catalog.find((option) => option.tier === 'balanced');
  return balanced?.id ?? catalog[0]?.id ?? ASSISTANT_DEFAULT_MODEL[provider];
}

/** The inputs the router needs for one turn. */
export interface AssistantModelRouteInput {
  provider: AssistantProvider;
  /** The shop's saved model (`auto`, empty, or a pinned id). */
  model: string;
  question?: string;
  hasPhoto?: boolean;
  hasTextFile?: boolean;
}

/** The router's answer. */
export interface AssistantModelRoute {
  /** The exact model to send to the provider. */
  model: string;
  tier: AssistantModelTier;
  task: AssistantTaskKind;
  /** True when the router chose the model (the shop's id was not used). */
  auto: boolean;
  /**
   * `auto` — the shop asked for auto; `provider-mismatch` — the saved id
   * belonged to the other provider; `vision` — a photo needed a seeing model;
   * null — the shop's pinned model was used unchanged.
   */
  reason: 'auto' | 'provider-mismatch' | 'vision' | null;
}

/**
 * Choose the model for one turn.
 *
 * A pinned model is used as it is (the owner's choice wins), except that a
 * photo forces a seeing model. Everything else follows the task.
 */
export function routeAssistantModel(input: AssistantModelRouteInput): AssistantModelRoute {
  const provider: AssistantProvider = input.provider === 'nvidia' ? 'nvidia' : 'anthropic';
  const requested = String(input.model ?? '').trim();
  const task = classifyAssistantTask(input.question ?? '', {
    hasPhoto: input.hasPhoto,
    hasTextFile: input.hasTextFile,
  });
  const explicit = !isAutoModel(provider, requested);

  // A photo needs a model that can SEE it. When the pinned model can, it keeps
  // the turn (its own words + the photo); otherwise the vision model answers.
  if (input.hasPhoto) {
    if (explicit && modelSupportsVision(provider, requested)) {
      return { model: requested, tier: 'vision', task, auto: false, reason: null };
    }
    const fallback = visionModelFor(provider, requested) ?? modelForTier(provider, 'vision');
    return { model: fallback || modelForTier(provider, 'balanced'), tier: 'vision', task, auto: true, reason: 'vision' };
  }

  if (explicit) {
    const known = (ASSISTANT_MODEL_CATALOG[provider] ?? []).find(
      (option) => option.id.toLowerCase() === requested.toLowerCase()
    );
    return { model: requested, tier: known?.tier ?? 'balanced', task, auto: false, reason: null };
  }

  const tier = tierForTask(task);
  const mismatch = !!requested && !modelFitsProvider(provider, requested);
  return {
    model: modelForTier(provider, tier),
    tier,
    task,
    auto: true,
    reason: mismatch ? 'provider-mismatch' : 'auto',
  };
}

/**
 * The models to try, in order, when an auto-routed call fails.
 *
 * The model that was just tried is NOT in the list. The vision model is never
 * a fallback for a text turn (it is slower and only earns its cost on a
 * photo). Balanced → fast → strong, so a rate-limited big model still gets an
 * answer.
 */
export function autoFallbackChain(provider: AssistantProvider, preferred: string): string[] {
  const catalog = ASSISTANT_MODEL_CATALOG[provider] ?? [];
  const skip = String(preferred ?? '').trim().toLowerCase();
  const out: string[] = [];
  const order: AssistantModelTier[] = ['balanced', 'fast', 'strong'];
  for (const tier of order) {
    for (const option of catalog) {
      if (option.tier !== tier || option.vision) continue;
      if (option.id.toLowerCase() === skip || out.includes(option.id)) continue;
      out.push(option.id);
    }
  }
  return out;
}

/**
 * Should a failed turn be retried with another model?
 *
 * Always for a request the model itself refused (`invalid_request`: a bad or
 * retired model id). In auto mode also for a busy/broken provider — a smaller
 * model often answers while the big one is saturated. Never for a wrong key,
 * no internet, a cancelled turn or an exhausted budget: another model cannot
 * fix any of those.
 */
export function shouldRetryWithAnotherModel(code: string, auto: boolean): boolean {
  if (code === 'invalid_request') return true;
  if (!auto) return false;
  return code === 'rate_limited' || code === 'server_error' || code === 'timeout';
}
