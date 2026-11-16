/**
 * The assistant's settings in the main process — the DB side of
 * `src/shared/assistant/settings.ts`.
 *
 * The API key is stored with the app's EXISTING secret mechanism (the
 * `admin_settings` table, masked on the way out by `SECRET_ADMIN_KEYS`), it is
 * owner-only to write, and it never crosses the IPC boundary: the renderer only
 * ever learns whether a key is set and its last four characters.
 */
import { getAdminSetting, setAdminSetting } from '../admin';
import { can, currentUser } from '../auth';
import { getDb } from '../../db';
import { isMaskedSecret } from '../../utils/secrets';
import {
  ASSISTANT_SETTING_KEYS,
  DEFAULT_ASSISTANT_SETTINGS,
  parseAssistantSettings,
  type AssistantSettings,
} from '../../../shared/assistant/settings';
import {
  assistantAllowedForUser,
  encodeOptOutUsers,
  parseOptOutUsers,
} from '../../../shared/assistant/privacy';
import type { AssistantRole } from '../../../shared/assistant/types';
import { getDayUsage } from './usage';

/** The admin_settings key the per-user opt-out list lives in. */
export const ASSISTANT_OPT_OUT_KEY = 'assistant_optout_users';

/** The mask the assistant key hint uses — the last four characters only. */
export const ASSISTANT_KEY_MASK_PREFIX = '••••';

/** Is this the assistant's own "unchanged" mask (a hint, not a real key)? */
export function isAssistantKeyMask(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (isMaskedSecret(value)) return true;
  return /^•+\S{0,4}$/.test(value.trim());
}

/** The hint the UI shows: the mask plus the last four characters. */
export function assistantKeyHint(key: string | null | undefined): string {
  const trimmed = (key ?? '').trim();
  if (!trimmed) return '';
  const tail = trimmed.slice(-4);
  return `${ASSISTANT_KEY_MASK_PREFIX}${tail}`;
}

/** Every assistant setting, parsed (the API key is NOT part of it). */
export function getAssistantSettings(): AssistantSettings {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.values(ASSISTANT_SETTING_KEYS)) raw[key] = getAdminSetting(key) ?? undefined;
  return parseAssistantSettings(raw);
}

/** The settings as the renderer sees them: the values plus the key hint. */
export function getAssistantSettingsView(): AssistantSettings & {
  keySet: boolean;
  keyHint: string;
  spendTodayUsd: number;
  callsToday: number;
} {
  const settings = getAssistantSettings();
  const key = getAdminSetting(ASSISTANT_SETTING_KEYS.apiKey) ?? '';
  let spendTodayUsd = 0;
  let callsToday = 0;
  try {
    // The cost is part of the transparency: the owner sees what the assistant
    // spent today, next to the cap they set.
    const usage = getDayUsage();
    spendTodayUsd = Number(usage.costUsd) || 0;
    callsToday = Number(usage.calls) || 0;
  } catch {
    /* the usage table may not exist yet */
  }
  return {
    ...settings,
    keySet: key.trim().length > 0,
    keyHint: assistantKeyHint(key),
    spendTodayUsd,
    callsToday,
  };
}

/**
 * The users who turned the assistant off for THEMSELVES.
 *
 * The list lives in the app's own `admin_settings` table (a system-managed
 * key — it is written directly, because `setAdminSetting` is owner-only and
 * this one is a decision by the user themselves).
 */
export function getAssistantOptOuts(): number[] {
  return parseOptOutUsers(getAdminSetting(ASSISTANT_OPT_OUT_KEY));
}

/** Has this user turned the assistant off for themselves? */
export function assistantOptedOut(userId: number | null | undefined): boolean {
  if (!userId) return false;
  return getAssistantOptOuts().includes(Number(userId));
}

/**
 * Turn the assistant off (or on again) for the signed-in user.
 *
 * A user may only decide for THEMSELVES — nobody else can turn it off for
 * them, and nobody else can turn it back on for them either.
 */
export function setAssistantOptOut(optedOut: boolean): { optedOut: boolean; userId: number | null } {
  const user = currentUser();
  if (!user) throw new Error('Sign in again.');
  const ids = getAssistantOptOuts().filter((id) => id !== user.id);
  if (optedOut) ids.push(user.id);
  getDb()
    .prepare('INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(ASSISTANT_OPT_OUT_KEY, encodeOptOutUsers(ids));
  return { optedOut: optedOut === true, userId: user.id };
}

/**
 * May the signed-in user use the assistant at all?
 *
 * The kill switch, the role list AND the user's own opt-out all count. The
 * session is the default — a caller may only pass its own user.
 */
export function assistantAllowedForSession(userId?: number | null, role?: string | null): boolean {
  const settings = getAssistantSettings();
  const user = currentUser();
  const id = userId ?? user?.id ?? null;
  const userRole = role ?? user?.role ?? null;
  return assistantAllowedForUser(settings, userRole, id, getAssistantOptOuts());
}

/**
 * Save the assistant settings. OWNER ONLY — the same rule as every other
 * admin setting (`setAdminSetting` refuses a non-owner on its own, this makes
 * the rule explicit for the assistant).
 */
export function saveAssistantSettings(patch: {
  enabled?: boolean;
  roles?: AssistantRole[];
  model?: string;
  dailyBudgetUsd?: number;
  dataLevel?: string;
  language?: string;
  actionsEnabled?: boolean;
  proactiveEnabled?: boolean;
}): AssistantSettings {
  if (!can('owner')) throw new Error('Only the owner can change the assistant settings');
  const set = (key: string, value: string) => setAdminSetting(key, value);
  if (typeof patch.enabled === 'boolean') set(ASSISTANT_SETTING_KEYS.enabled, patch.enabled ? '1' : '0');
  if (typeof patch.actionsEnabled === 'boolean') set(ASSISTANT_SETTING_KEYS.actions, patch.actionsEnabled ? '1' : '0');
  if (typeof patch.proactiveEnabled === 'boolean') set(ASSISTANT_SETTING_KEYS.proactive, patch.proactiveEnabled ? '1' : '0');
  if (Array.isArray(patch.roles)) set(ASSISTANT_SETTING_KEYS.roles, patch.roles.join(','));
  if (typeof patch.model === 'string') set(ASSISTANT_SETTING_KEYS.model, patch.model.trim());
  if (typeof patch.dailyBudgetUsd === 'number' && Number.isFinite(patch.dailyBudgetUsd) && patch.dailyBudgetUsd >= 0) {
    set(ASSISTANT_SETTING_KEYS.budget, String(patch.dailyBudgetUsd));
  }
  if (typeof patch.dataLevel === 'string') set(ASSISTANT_SETTING_KEYS.dataLevel, patch.dataLevel);
  if (typeof patch.language === 'string') set(ASSISTANT_SETTING_KEYS.language, patch.language);
  return getAssistantSettings();
}

/**
 * Store the API key. OWNER ONLY. An empty string clears it; a masked value
 * means "leave it as it is" (the renderer always sends back what it was shown).
 */
export function setAssistantApiKey(key: string): { keySet: boolean; keyHint: string } {
  if (!can('owner')) throw new Error('Only the owner can change the assistant settings');
  const value = (key ?? '').trim();
  if (isAssistantKeyMask(value)) return getAssistantSettingsView();
  if (value === '') {
    setAdminSetting(ASSISTANT_SETTING_KEYS.apiKey, '');
    return getAssistantSettingsView();
  }
  setAdminSetting(ASSISTANT_SETTING_KEYS.apiKey, value);
  return getAssistantSettingsView();
}

/**
 * The real key — MAIN PROCESS ONLY. Never call this from the renderer, never
 * put the result into a log line, an error message or an IPC payload.
 */
export function resolveAssistantApiKey(): string {
  return (getAdminSetting(ASSISTANT_SETTING_KEYS.apiKey) ?? '').trim();
}

/** Is the assistant usable at all? (The kill switch + a key + a model.) */
export function assistantReady(): { ok: boolean; reason: 'disabled' | 'no_key' | 'no_model' | null } {
  const settings = getAssistantSettings();
  if (!settings.enabled) return { ok: false, reason: 'disabled' };
  if (!resolveAssistantApiKey()) return { ok: false, reason: 'no_key' };
  if (!settings.model) return { ok: false, reason: 'no_model' };
  return { ok: true, reason: null };
}

/** The defaults, re-exported so the UI can show them. */
export { DEFAULT_ASSISTANT_SETTINGS };
