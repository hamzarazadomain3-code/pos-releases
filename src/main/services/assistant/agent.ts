/**
 * The assistant's turn runner — the main-process half of the agent loop.
 *
 * It ties together the pieces the app already has: the settings (the kill
 * switch, the roles, the language, the data level, the budget), the app's own
 * session (`currentUser()` — the role is NEVER taken from the model), the tool
 * registry with the real implementations, the provider adapter and the
 * activity log.
 */
import { currentUser } from '../auth';
import { getAllSettings } from '../settings';
import { getAdminSetting } from '../admin';
import { runAgentTurn, type AgentStopReason, type PendingActionDraft } from '../../../shared/assistant/agent';
import { DEFAULT_ASSISTANT_LIMITS, RateLimiter, type AssistantLimits } from '../../../shared/assistant/limits';
import { assistantErrorMessage } from '../../../shared/assistant/provider';
import { buildSystemPrompt } from '../../../shared/assistant/prompt';
import { assistantRoleAllowed } from '../../../shared/assistant/settings';
import { buildToolRegistry, toolsForRole } from '../../../shared/assistant/tools';
import { contentHash } from '../../../shared/assistant/hash';
import type { AssistantMessage, AssistantUsage } from '../../../shared/assistant/types';
import { buildAssistantToolImplementations } from './toolImpls';
import { createProviderForSettings } from './runtime';
import { getAssistantSettings } from './settings';
import { logAssistantActivity } from './activity';
import { addDayUsage, getDayUsage } from './usage';

const rateLimiter = new RateLimiter(DEFAULT_ASSISTANT_LIMITS.turnsPerMinute);
let currentAbort: AbortController | null = null;

export interface AssistantTurnRequest {
  message: string;
  /** The page the user is on (a route id from the menu definition). */
  route?: string | null;
  /** The conversation so far. */
  history?: AssistantMessage[];
}

export interface AssistantTurnResponse {
  ok: boolean;
  text: string;
  usage: AssistantUsage;
  pendingActions: PendingActionDraft[];
  stop: AgentStopReason;
  failure?: { code: string; message: string };
}

/** The secrets that must never leave the shop, whatever the data level is. */
function shopSecrets(): string[] {
  const secrets: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (text.length >= 8) secrets.push(text);
  };
  push(getAdminSetting('assistant_api_key'));
  push(getAdminSetting('license_key'));
  push(getAdminSetting('email_smtp_pass'));
  push(getAdminSetting('sms_api_key'));
  push(getAdminSetting('sms_api_secret'));
  push(getAdminSetting('whatsapp_api_token'));
  push(getAdminSetting('whatsapp_token'));
  return secrets;
}

/** The limits for this shop (the budget comes from the settings). */
export function assistantLimits(): AssistantLimits {
  const settings = getAssistantSettings();
  return { ...DEFAULT_ASSISTANT_LIMITS, dailyBudgetUsd: settings.dailyBudgetUsd };
}

/** Stop the turn that is running right now. */
export function cancelAssistantTurn(): boolean {
  if (!currentAbort) return false;
  currentAbort.abort();
  currentAbort = null;
  return true;
}

/**
 * Run one assistant turn.
 *
 * The kill switch, the role gate and the rate limit are checked BEFORE the
 * provider is called, so a disabled assistant never reaches the network.
 */
export async function runAssistantTurn(request: AssistantTurnRequest): Promise<AssistantTurnResponse> {
  const settings = getAssistantSettings();
  const emptyUsage: AssistantUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };

  if (!settings.enabled) {
    return {
      ok: false,
      text: '',
      usage: emptyUsage,
      pendingActions: [],
      stop: 'error',
      failure: { code: 'disabled', message: assistantErrorMessage('disabled', settings.language) },
    };
  }

  const user = currentUser();
  if (!user) {
    return {
      ok: false,
      text: '',
      usage: emptyUsage,
      pendingActions: [],
      stop: 'error',
      failure: { code: 'unauthorized', message: assistantErrorMessage('unauthorized', settings.language) },
    };
  }
  if (!assistantRoleAllowed(settings, user.role)) {
    return {
      ok: false,
      text: '',
      usage: emptyUsage,
      pendingActions: [],
      stop: 'error',
      failure: { code: 'unauthorized', message: assistantErrorMessage('unauthorized', settings.language) },
    };
  }

  const message = String(request.message ?? '').trim();
  if (!message) {
    return {
      ok: false,
      text: '',
      usage: emptyUsage,
      pendingActions: [],
      stop: 'error',
      failure: { code: 'invalid_request', message: assistantErrorMessage('invalid_request', settings.language) },
    };
  }

  if (!rateLimiter.allow(String(user.id))) {
    return {
      ok: false,
      text: '',
      usage: emptyUsage,
      pendingActions: [],
      stop: 'error',
      failure: { code: 'rate_limited', message: assistantErrorMessage('rate_limited', settings.language) },
    };
  }

  const limits = assistantLimits();
  const day = getDayUsage();
  const budget = { spentUsd: day.costUsd, budgetUsd: limits.dailyBudgetUsd };

  const registry = buildToolRegistry(buildAssistantToolImplementations());
  const roleTools = toolsForRole(registry, user.role);
  const shopSettings = getAllSettings();
  const system = buildSystemPrompt({
    role: user.role as 'owner' | 'manager' | 'cashier',
    language: settings.language,
    dataLevel: settings.dataLevel,
    actionsEnabled: settings.actionsEnabled,
    timezone: shopSettings.shop_timezone,
    now: new Date().toISOString(),
  });

  const controller = new AbortController();
  currentAbort = controller;
  const history = Array.isArray(request.history) ? request.history.slice(-12) : [];

  try {
    const result = await runAgentTurn({
      adapter: createProviderForSettings({ language: settings.language === 'auto' ? 'en' : settings.language }),
      model: settings.model,
      system,
      messages: [...history, { role: 'user', content: message }],
      tools: roleTools,
      executeTool: async (name, input) => {
        const tool = registry.find((t) => t.name === name);
        if (!tool || !tool.impl) throw new Error('That tool is not available.');
        return tool.impl.execute(
          {
            user: { id: user.id, username: user.username, role: user.role as 'owner' | 'manager' | 'cashier' },
            branchId: null,
            language: settings.language,
            dataLevel: settings.dataLevel,
            actionsEnabled: settings.actionsEnabled,
            route: request.route ?? null,
          },
          input
        );
      },
      limits,
      budget,
      dataLevel: settings.dataLevel,
      secrets: shopSecrets(),
      language: settings.language === 'auto' ? 'en' : settings.language,
      signal: controller.signal,
    });

    addDayUsage(result.usage);

    // The activity log keeps a HASH of the question and the tool names — never
    // the question itself, never a secret.
    logAssistantActivity(
      'question',
      `hash=${contentHash(message)} tools=${result.toolCalls} stop=${result.stop} cost=${result.usage.costUsd}`
    );

    if (result.failure) {
      return {
        ok: false,
        text: result.text,
        usage: result.usage,
        pendingActions: result.pendingActions,
        stop: result.stop,
        failure: { code: result.failure.code, message: result.failure.message },
      };
    }

    return {
      ok: true,
      text: result.text,
      usage: result.usage,
      pendingActions: result.pendingActions,
      stop: result.stop,
    };
  } finally {
    if (currentAbort === controller) currentAbort = null;
  }
}

/** The rate limiter (the tests reset it). */
export function assistantRateLimiter(): RateLimiter {
  return rateLimiter;
}
