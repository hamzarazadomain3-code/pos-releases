/**
 * The assistant's contract — the shapes the main process, the renderer and the
 * provider adapter all agree on.
 *
 * Everything here is pure data. Nothing in `src/shared/assistant/` may import a
 * Node builtin or a main-process service: the renderer bundles this folder, and
 * the business logic (the services) lives behind dependency injection (the tool
 * registry is built with the implementations handed to it).
 */

/** The roles the app knows — the SAME ladder as `src/shared/roles.ts`. */
export type AssistantRole = 'owner' | 'manager' | 'cashier';

/** The language the assistant answers in. `auto` follows the shop's language. */
export type AssistantLanguage = 'auto' | 'en' | 'ur' | 'roman';

/**
 * How much shop data may leave the device.
 *
 *  - `aggregates` — totals only (no names, no phone numbers, no addresses)
 *  - `names`     — totals + product/customer names
 *  - `full`      — everything the tool returned, including contact details
 */
export type AssistantDataLevel = 'aggregates' | 'names' | 'full';

/** What a tool may do. `forbidden` tools are never registered at all. */
export type AssistantRisk = 'read' | 'write' | 'dangerous' | 'forbidden';

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface JsonSchemaProperty {
  type: JsonSchemaType;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: { type: 'string' | 'number' };
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  /** Always false — an unknown field is a rejection, never a silent ignore. */
  additionalProperties: false;
}

/** A tool as the model sees it. */
export interface AssistantToolDefinition {
  name: string;
  /** English, model-facing. */
  description: string;
  inputSchema: JsonSchema;
  risk: AssistantRisk;
  /**
   * The existing permission id that guards the same action in the app (for
   * example `view_reports`, `manage_udhaar`). The app enforces its
   * permissions by ROLE RANK, so the role lives on the tool itself.
   */
  requiredPermission?: string;
  /** A narrowing on top of the role (when present). */
  allowedRoles?: AssistantRole[];
  /** True for the tools that change data (they still need the confirm flow). */
  write?: boolean;
}

/** A tool call the model asked for. */
export interface AssistantToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** What a tool returned. */
export interface AssistantToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type AssistantMessageRole = 'user' | 'assistant' | 'tool';

export interface AssistantMessage {
  role: AssistantMessageRole;
  content: string;
  /** Set on a `tool` message. */
  toolCallId?: string;
  /** Set on an `assistant` message that asked for tools. */
  toolCalls?: AssistantToolCall[];
  /** The tool name on a `tool` message. */
  name?: string;
}

export interface ProviderRequest {
  /** The model id — a SETTING, never a hardcoded name. */
  model: string;
  /** The system prompt (already built from the templates). */
  system: string;
  messages: AssistantMessage[];
  tools: AssistantToolDefinition[];
  maxOutputTokens: number;
  temperature?: number;
  /** Cancellation. */
  signal?: AbortSignal;
}

export type ProviderStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error';

export interface ProviderResponse {
  text: string;
  toolCalls: AssistantToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: ProviderStopReason;
}

/**
 * A provider adapter. The default one targets the Anthropic Messages API
 * (tool use); the tests use the MockProvider, so no test ever opens a socket.
 */
export interface ProviderAdapter {
  readonly id: string;
  send(request: ProviderRequest): Promise<ProviderResponse>;
}

/** Token/cost accounting for one turn. */
export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** How many provider calls this turn made (a retry counts twice). */
  calls: number;
}

/** The session a tool runs in. A tool NEVER trusts a role passed by the model. */
export interface AssistantContext {
  user: { id: number; username: string; role: AssistantRole };
  branchId: number | null;
  language: AssistantLanguage;
  dataLevel: AssistantDataLevel;
  /** False → the assistant may only read and guide. */
  actionsEnabled: boolean;
  /** The page the user is on (a route id from the menu definition). */
  route: string | null;
}

/** The settings as the renderer sees them — the API key is never one of them. */
export interface AssistantSettingsView {
  enabled: boolean;
  roles: AssistantRole[];
  model: string;
  dailyBudgetUsd: number;
  dataLevel: AssistantDataLevel;
  language: AssistantLanguage;
  actionsEnabled: boolean;
  proactiveEnabled: boolean;
  /** Is a key stored? */
  keySet: boolean;
  /** The mask + the last four characters (never the key itself). */
  keyHint: string;
  /** Where the key lives: the shop's own store (desktop) or the server (web). */
  keySource?: 'shop' | 'server';
}

/** What the settings screen may change. */
export interface AssistantSettingsPatch {
  enabled?: boolean;
  roles?: AssistantRole[];
  model?: string;
  dailyBudgetUsd?: number;
  dataLevel?: AssistantDataLevel;
  language?: AssistantLanguage;
  actionsEnabled?: boolean;
  proactiveEnabled?: boolean;
}

/** One row of the assistant's activity log (it lives in the app's own table). */
export interface AssistantActivityRow {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
  username: string | null;
  user_id: number | null;
}

/** What the renderer sends for one assistant turn. */
export interface AssistantTurnRequest {
  message: string;
  /** The page the user is on (a route id from the menu definition). */
  route?: string | null;
  /** The conversation so far (the model-facing messages). */
  history?: AssistantMessage[];
}

/** A write tool's proposal — the user has to confirm it before it happens. */
export interface AssistantPendingAction {
  tool: string;
  args: Record<string, unknown>;
  risk: 'read' | 'write' | 'dangerous' | 'forbidden';
  reason?: string;
}

/** The answer to one assistant turn. */
export interface AssistantTurnResponse {
  ok: boolean;
  text: string;
  usage: AssistantUsage;
  pendingActions: AssistantPendingAction[];
  stop: string;
  failure?: { code: string; message: string };
  /** The source line — where the numbers in the answer came from. */
  source?: string;
  /** The numbers that could not be traced to a tool result (empty when all were). */
  unverifiedNumbers?: string[];
}

/** The failure codes the assistant speaks. */
export type AssistantErrorCode =  | 'disabled'
  | 'no_key'
  | 'offline'
  | 'timeout'
  | 'unauthorized'
  | 'rate_limited'
  | 'server_error'
  | 'budget_exceeded'
  | 'invalid_request'
  | 'cancelled'
  | 'unknown';

export interface AssistantFailure {
  code: AssistantErrorCode;
  /** The friendly message, already in the user's language. */
  message: string;
  /** True when a retry could help. */
  retryable: boolean;
}
