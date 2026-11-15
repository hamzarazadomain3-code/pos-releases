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
import { can } from '../auth';
import { isMaskedSecret } from '../../utils/secrets';
import {
  ASSISTANT_SETTING_KEYS,
  DEFAULT_ASSISTANT_SETTINGS,
  parseAssistantSettings,
  type AssistantSettings,
} from '../../../shared/assistant/settings';
import type { AssistantRole } from '../../../shared/assistant/types';

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
export function getAssistantSettingsView(): AssistantSettings & { keySet: boolean; keyHint: string } {
  const settings = getAssistantSettings();
  const key = getAdminSetting(ASSISTANT_SETTING_KEYS.apiKey) ?? '';
  return { ...settings, keySet: key.trim().length > 0, keyHint: assistantKeyHint(key) };
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
