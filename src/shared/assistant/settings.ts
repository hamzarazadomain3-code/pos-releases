/**
 * The assistant's settings — the pure model.
 *
 * The values live in `admin_settings` (the app's own owner-only settings table),
 * so they survive an upgrade and are changeable in the UI without a rebuild.
 * This module is the ONE place that knows what a setting means; both the main
 * process (which reads/writes the table) and the renderer (which shows the
 * screen) use it.
 *
 * THE DEFAULTS KEEP EVERY EXISTING INSTALL UNCHANGED: the assistant is OFF.
 */
import type { AssistantDataLevel, AssistantLanguage, AssistantRole } from './types';

export const ASSISTANT_ROLES: AssistantRole[] = ['owner', 'manager', 'cashier'];
export const ASSISTANT_DATA_LEVELS: AssistantDataLevel[] = ['aggregates', 'names', 'full'];
export const ASSISTANT_LANGUAGES: AssistantLanguage[] = ['auto', 'en', 'ur', 'roman'];

/** The admin_settings keys the assistant owns. */
export const ASSISTANT_SETTING_KEYS = {
  enabled: 'assistant_enabled',
  roles: 'assistant_roles',
  model: 'assistant_model',
  budget: 'assistant_daily_budget_usd',
  dataLevel: 'assistant_data_level',
  language: 'assistant_language',
  actions: 'assistant_actions_enabled',
  proactive: 'assistant_proactive_enabled',
  apiKey: 'assistant_api_key',
} as const;

export interface AssistantSettings {
  /** The kill switch. Nothing works while this is false. */
  enabled: boolean;
  /** The roles that may use the assistant at all. */
  roles: AssistantRole[];
  /** The provider model id — a SETTING, never a hardcoded name in the code. */
  model: string;
  /** The daily spend cap (USD). */
  dailyBudgetUsd: number;
  /** How much shop data may leave the device. */
  dataLevel: AssistantDataLevel;
  /** The language the assistant answers in. */
  language: AssistantLanguage;
  /** False → read/guide only, no writes at all. */
  actionsEnabled: boolean;
  /** False → no proactive insights. */
  proactiveEnabled: boolean;
}

/** A small daily cap: enough for a shop's questions, small enough to be safe. */
export const DEFAULT_ASSISTANT_BUDGET_USD = 1;

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: false,
  roles: ['owner', 'manager'],
  model: '',
  dailyBudgetUsd: DEFAULT_ASSISTANT_BUDGET_USD,
  dataLevel: 'aggregates',
  language: 'auto',
  actionsEnabled: false,
  proactiveEnabled: false,
};

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === true) return true;
  if (value === false) return false;
  const v = String(value ?? '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const text = String(value ?? '').trim();
  // An empty value means "not set" — `Number('')` is 0, which would silently
  // turn a missing budget into "no budget at all".
  if (text === '') return fallback;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/** Parse the raw settings map into the assistant's settings. */
export function parseAssistantSettings(raw: Record<string, string | undefined>): AssistantSettings {
  const rolesRaw = String(raw[ASSISTANT_SETTING_KEYS.roles] ?? '').trim();
  const roles = rolesRaw
    ? (rolesRaw
        .split(',')
        .map((r) => r.trim().toLowerCase())
        .filter((r): r is AssistantRole => (ASSISTANT_ROLES as string[]).includes(r)) as AssistantRole[])
    : [...DEFAULT_ASSISTANT_SETTINGS.roles];
  const level = String(raw[ASSISTANT_SETTING_KEYS.dataLevel] ?? '').trim().toLowerCase();
  const language = String(raw[ASSISTANT_SETTING_KEYS.language] ?? '').trim().toLowerCase();
  return {
    enabled: asBool(raw[ASSISTANT_SETTING_KEYS.enabled], DEFAULT_ASSISTANT_SETTINGS.enabled),
    roles: roles.length > 0 ? roles : [...DEFAULT_ASSISTANT_SETTINGS.roles],
    model: String(raw[ASSISTANT_SETTING_KEYS.model] ?? '').trim(),
    dailyBudgetUsd: asNumber(raw[ASSISTANT_SETTING_KEYS.budget], DEFAULT_ASSISTANT_SETTINGS.dailyBudgetUsd),
    dataLevel: (ASSISTANT_DATA_LEVELS as string[]).includes(level)
      ? (level as AssistantDataLevel)
      : DEFAULT_ASSISTANT_SETTINGS.dataLevel,
    language: (ASSISTANT_LANGUAGES as string[]).includes(language)
      ? (language as AssistantLanguage)
      : DEFAULT_ASSISTANT_SETTINGS.language,
    actionsEnabled: asBool(raw[ASSISTANT_SETTING_KEYS.actions], DEFAULT_ASSISTANT_SETTINGS.actionsEnabled),
    proactiveEnabled: asBool(raw[ASSISTANT_SETTING_KEYS.proactive], DEFAULT_ASSISTANT_SETTINGS.proactiveEnabled),
  };
}

/** May this role use the assistant at all? */
export function assistantRoleAllowed(settings: AssistantSettings, role: string | null | undefined): boolean {
  if (!role) return false;
  return settings.roles.includes(role as AssistantRole);
}

/** May this role run a WRITE action? (The switch AND the role both matter.) */
export function assistantActionsAllowed(settings: AssistantSettings, role: string | null | undefined): boolean {
  if (!settings.actionsEnabled) return false;
  if (!role) return false;
  // A write action always needs at least a manager.
  if (role !== 'owner' && role !== 'manager') return false;
  return assistantRoleAllowed(settings, role);
}
