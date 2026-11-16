/**
 * The privacy and transparency page — the pure model.
 *
 * The page is GENERATED from the tool registry, so it can never drift from
 * what the assistant may really do: every tool, what it does, how risky it is
 * and which roles may use it.
 *
 * It also carries the opt-out model: a user (a cashier, or anybody) may turn
 * the assistant off for their OWN account. The owner never has to do it for
 * them, and nobody else may turn it off for them.
 */
import type { AssistantRole } from './types';
import type { AssistantTool } from './tools';

/** The roles, from the weakest to the strongest (the app's own ladder). */
export const ASSISTANT_ROLE_ORDER: AssistantRole[] = ['cashier', 'manager', 'owner'];

/** One row of the privacy table. */
export interface PrivacyToolRow {
  /** The tool's name (the registry's name — never a made-up one). */
  name: string;
  /** What the tool does, in plain words (the registry's own description). */
  description: string;
  /** How risky the tool is. */
  risk: 'read' | 'write' | 'dangerous' | 'forbidden';
  /** True when the tool can change the shop's books (it still needs a confirmation). */
  writes: boolean;
  /** The roles that may use it. */
  roles: AssistantRole[];
}

/** The roles that may use this tool (its own ladder plus its narrowing). */
export function rolesForTool(tool: AssistantTool): AssistantRole[] {
  const minIndex = ASSISTANT_ROLE_ORDER.indexOf(tool.minRole);
  const from = ASSISTANT_ROLE_ORDER.slice(minIndex < 0 ? 0 : minIndex);
  if (!tool.allowedRoles || tool.allowedRoles.length === 0) return from;
  return from.filter((role) => tool.allowedRoles!.includes(role));
}

/** The privacy rows for a registry (one per tool). */
export function privacyRows(tools: AssistantTool[]): PrivacyToolRow[] {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    writes: tool.write === true,
    roles: rolesForTool(tool),
  }));
}

/** How many tools there are, and how many of each kind. */
export function privacySummary(rows: PrivacyToolRow[]): {
  total: number;
  read: number;
  write: number;
  dangerous: number;
} {
  const list = rows ?? [];
  return {
    total: list.length,
    read: list.filter((r) => r.risk === 'read').length,
    write: list.filter((r) => r.risk === 'write').length,
    dangerous: list.filter((r) => r.risk === 'dangerous').length,
  };
}

/** The users who turned the assistant off for themselves. */
export function parseOptOutUsers(raw: string | null | undefined): number[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const ids = new Set<number>();
  for (const part of text.split(',')) {
    const id = Number(part.trim());
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** The list as it is stored (a comma-separated list of user ids). */
export function encodeOptOutUsers(ids: number[]): string {
  return parseOptOutUsers((ids ?? []).join(','))
    .join(',');
}

/** May this user use the assistant at all? */
export function assistantAllowedForUser(
  settings: { enabled: boolean; roles: AssistantRole[] },
  role: string | null | undefined,
  userId: number | null | undefined,
  optOutIds: number[]
): boolean {
  if (!settings?.enabled) return false;
  if (!role) return false;
  if (!settings.roles.includes(role as AssistantRole)) return false;
  if (userId && (optOutIds ?? []).includes(Number(userId))) return false;
  return true;
}
