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
import { sourceLineFor } from '../../../shared/assistant/sources';
import { assistantRoleAllowed } from '../../../shared/assistant/settings';
import { buildToolRegistry, toolAllowedForRole, toolsForRole } from '../../../shared/assistant/tools';
import { contentHash } from '../../../shared/assistant/hash';
import type { AssistantContext, AssistantMessage, AssistantPendingAction, AssistantUsage } from '../../../shared/assistant/types';
import { buildAssistantToolImplementations } from './toolImpls';
import { createProviderForSettings } from './runtime';
import { getAssistantSettings } from './settings';
import { cancelPendingAction, confirmPendingAction, createPendingAction, listPendingActions } from './pending';
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
  /** The source line — where the numbers in the answer came from. */
  source?: string;
  /** The numbers that could not be traced to a tool result. */
  unverifiedNumbers?: string[];
  /** The guide the assistant started (the overlay walks the user through it). */
  guide?: string;
}
/** The guide a turn started (the `start_guide` tool's own result). */
function startedGuide(results: unknown[]): string | undefined {
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const row = result as { ok?: unknown; guideId?: unknown };
    if (row.ok === true && typeof row.guideId === 'string' && row.guideId) return row.guideId;
  }
  return undefined;
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

    // A proposed write becomes a waiting action: the owner confirms IT (by
    // its id) and the real service runs only then.
    const cards: AssistantPendingAction[] = [];
    for (const draft of result.pendingActions) {
      const tool = registry.find((t) => t.name === draft.tool);
      let preview: { summary?: string; details?: { label: string; before?: unknown; after?: unknown }[] } | undefined;
      try {
        preview = tool?.impl?.preview
          ? await tool.impl.preview(
              {
                user: { id: user.id, username: user.username, role: user.role as 'owner' | 'manager' | 'cashier' },
                branchId: null,
                language: settings.language,
                dataLevel: settings.dataLevel,
                actionsEnabled: settings.actionsEnabled,
                route: request.route ?? null,
              },
              draft.args
            )
          : undefined;
      } catch {
        preview = undefined;
      }
      const row = createPendingAction({
        tool: draft.tool,
        args: draft.args,
        risk: draft.risk,
        reason: draft.reason,
        preview,
        userId: user.id,
        username: user.username,
      });
      cards.push({
        tool: draft.tool,
        args: draft.args,
        risk: draft.risk,
        reason: draft.reason,
        id: row.id,
        preview: row.preview,
        details: row.details,
        expires_at: row.expires_at,
        status: 'pending',
      });
    }

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
        pendingActions: cards,
        stop: result.stop,
        failure: { code: result.failure.code, message: result.failure.message },
        source: sourceLineFor(result.sources ?? []),
        unverifiedNumbers: result.unverifiedNumbers ?? [],
        guide: startedGuide(result.verifiedAgainst ?? []),
      };
    }

    return {
      ok: true,
      text: result.text,
      usage: result.usage,
      pendingActions: cards,
      stop: result.stop,
      source: sourceLineFor(result.sources ?? []),
      unverifiedNumbers: result.unverifiedNumbers ?? [],
      guide: startedGuide(result.verifiedAgainst ?? []),
    };
  } finally {
    if (currentAbort === controller) currentAbort = null;
  }
}

/** The rate limiter (the tests reset it). */
export function assistantRateLimiter(): RateLimiter {
  return rateLimiter;
}

/** The context a confirmed action runs in — the role comes from the SESSION. */
function actionContext(user: { id: number; username: string; role: string }, route?: string | null): AssistantContext {
  const settings = getAssistantSettings();
  return {
    user: { id: user.id, username: user.username, role: user.role as 'owner' | 'manager' | 'cashier' },
    branchId: null,
    language: settings.language,
    dataLevel: settings.dataLevel,
    actionsEnabled: settings.actionsEnabled,
    route: route ?? null,
  };
}

/** The waiting actions (the owner sees them in the panel). */
export function assistantPendingActions() {
  return listPendingActions();
}

/**
 * Confirm a waiting action — the owner said yes.
 *
 * The tool's REAL implementation runs now, through the very same service the
 * normal UI uses, with the role of the session (never the role the model
 * asked for). A role that may not use the tool is refused.
 */
export async function confirmAssistantAction(
  id: number
): Promise<{ ok: boolean; message?: string; tool?: string; result?: unknown }> {
  const user = currentUser();
  if (!user) return { ok: false, message: 'Sign in again.' };
  const settings = getAssistantSettings();
  if (!settings.enabled) return { ok: false, message: 'The assistant is switched off.' };
  if (!assistantRoleAllowed(settings, user.role)) {
    return { ok: false, message: 'This role may not use the assistant.' };
  }
  const registry = buildToolRegistry(buildAssistantToolImplementations());
  const ctx = actionContext(user);
  const result = await confirmPendingAction(
    id,
    async (tool, args, context) => {
      const found = registry.find((t) => t.name === tool);
      if (!found?.impl) throw new Error('That action is not available.');
      if (!toolAllowedForRole(found, user.role)) {
        throw new Error('This role may not do that.');
      }
      return found.impl.execute(context, args);
    },
    ctx
  );
  return {
    ok: result.ok,
    message: result.message,
    tool: result.row?.tool,
    // The tool's own result (a billing action carries the command the Billing
    // screen has to apply — the bill lives in the renderer).
    result: result.row?.result,
  };
}

/** Cancel a waiting action — nothing happens. */
export function cancelAssistantAction(id: number): { ok: boolean; message?: string } {
  const user = currentUser();
  if (!user) return { ok: false, message: 'Sign in again.' };
  const result = cancelPendingAction(id);
  return { ok: result.ok, message: result.message };
}
