/**
 * The agent loop — server-side, with hard limits.
 *
 * The loop is deliberately dull: the model asks for tools, the loop runs the
 * READ tools, and a WRITE tool never runs here — it becomes a pending action
 * the user has to confirm (Item 8).
 *
 * Everything that can run away is capped: the tool calls per turn, the
 * provider round-trips, the output tokens, the wall clock, the daily budget
 * and the loop detection.
 */
import { assistantFailure, estimateCostUsd } from './provider';
import {
  budgetAvailable,
  isLoopDetected,
  type AssistantLimits,
  type BudgetState,
  type ToolCallSignature,
} from './limits';
import { redactResult } from './redact';
import { wrapToolData, wrapToolError } from './prompt';
import { isWriteTool, type AssistantTool, type ToolRisk } from './tools';
import type {
  AssistantDataLevel,
  AssistantFailure,
  AssistantMessage,
  AssistantToolCall,
  AssistantUsage,
  ProviderAdapter,
} from './types';

/** A write tool's proposal — it becomes a pending action, never an execution. */
export interface PendingActionDraft {
  tool: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  /** The model's own words for why it wants this. */
  reason?: string;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'pending_action'; tool: string; risk: ToolRisk }
  | { type: 'limit'; reason: string };

export interface AgentTurnInput {
  adapter: ProviderAdapter;
  /** The model id — it comes from the `assistant_model` setting. */
  model: string;
  system: string;
  messages: AssistantMessage[];
  /** The registry (the loop uses it for the validation and the risk). */
  tools: AssistantTool[];
  /** Runs a READ tool. The raw data comes back; the loop redacts it. */
  executeTool: (name: string, input: Record<string, unknown>, callId: string) => Promise<unknown>;
  limits: AssistantLimits;
  budget: BudgetState;
  dataLevel: AssistantDataLevel;
  /** The secrets that must never leave (the provider key, the licence key…). */
  secrets?: string[];
  /** The language the failure messages use. */
  language?: 'en' | 'ur' | 'roman';
  now?: () => number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentStopReason =
  | 'end_turn'
  | 'tool_limit'
  | 'turn_limit'
  | 'time_limit'
  | 'loop_limit'
  | 'budget'
  | 'cancelled'
  | 'error';

export interface AgentTurnResult {
  text: string;
  messages: AssistantMessage[];
  usage: AssistantUsage;
  toolCalls: number;
  pendingActions: PendingActionDraft[];
  stop: AgentStopReason;
  failure?: AssistantFailure;
}

/**
 * Run one turn of the assistant.
 *
 * The loop stops at the first limit that is reached and says so — it never
 * keeps calling the provider in the background.
 */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const now = input.now ?? (() => Date.now());
  const started = now();
  const language = input.language ?? 'en';
  const messages: AssistantMessage[] = [...input.messages];
  const usage: AssistantUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
  const calls: ToolCallSignature[] = [];
  const pendingActions: PendingActionDraft[] = [];
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  let text = '';
  let stop: AgentStopReason = 'turn_limit';
  let failure: AssistantFailure | undefined;
  /** Set when a limit stopped the turn (the loop must not continue). */
  let limitHit = false;

  const emit = (event: AgentEvent) => {
    try {
      input.onEvent?.(event);
    } catch {
      /* an event listener must never break the turn */
    }
  };

  for (let turn = 0; turn < input.limits.maxTurns; turn++) {
    if (input.signal?.aborted) {
      stop = 'cancelled';
      failure = assistantFailure('cancelled', language);
      break;
    }
    if (now() - started > input.limits.wallClockMs) {
      stop = 'time_limit';
      failure = assistantFailure('timeout', language);
      emit({ type: 'limit', reason: 'wall clock' });
      break;
    }
    if (!budgetAvailable(input.budget)) {
      stop = 'budget';
      failure = assistantFailure('budget_exceeded', language);
      emit({ type: 'limit', reason: 'daily budget' });
      break;
    }

    let response;
    try {
      response = await input.adapter.send({
        model: input.model,
        system: input.system,
        messages,
        tools: input.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          risk: t.risk,
          requiredPermission: t.requiredPermission,
          allowedRoles: t.allowedRoles,
          write: t.write,
        })),
        maxOutputTokens: input.limits.maxOutputTokens,
        signal: input.signal,
      });
    } catch (e) {
      const failureFromError = e as { failure?: AssistantFailure; message?: string };
      stop = 'error';
      failure = failureFromError.failure ?? assistantFailure('unknown', language);
      break;
    }

    usage.calls += 1;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.costUsd = estimateCostUsd(input.model, usage.inputTokens, usage.outputTokens);

    if (response.toolCalls.length === 0) {
      text = response.text;
      if (text) emit({ type: 'text', text });
      stop = 'end_turn';
      break;
    }

    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });

    for (const call of response.toolCalls) {
      if (calls.length >= input.limits.maxToolCallsPerTurn) {
        stop = 'tool_limit';
        limitHit = true;
        failure = assistantFailure('unknown', language);
        emit({ type: 'limit', reason: 'tool calls per turn' });
        break;
      }
      calls.push({ name: call.name, input: call.input });
      if (isLoopDetected(calls)) {
        stop = 'loop_limit';
        limitHit = true;
        emit({ type: 'limit', reason: 'the same call repeated' });
        break;
      }
      emit({ type: 'tool_call', name: call.name, input: call.input });

      const tool = byName.get(call.name);
      if (!tool) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: wrapToolError(call.name, 'There is no tool with that name.'),
        });
        emit({ type: 'tool_result', name: call.name, ok: false });
        continue;
      }

      const validation = tool.validate(call.input);
      if (!validation.ok) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: wrapToolError(call.name, validation.error || 'The input was refused.'),
        });
        emit({ type: 'tool_result', name: call.name, ok: false });
        continue;
      }

      // A WRITE tool never runs inside the loop — it only proposes.
      if (isWriteTool(tool)) {
        pendingActions.push({ tool: tool.name, args: validation.value || {}, risk: tool.risk });
        emit({ type: 'pending_action', tool: tool.name, risk: tool.risk });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: tool.name,
          content: wrapToolData(tool.name, {
            status: 'proposed',
            message: 'The user must confirm this action before it happens.',
          }),
        });
        emit({ type: 'tool_result', name: call.name, ok: true });
        continue;
      }

      let raw: unknown;
      try {
        raw = await input.executeTool(tool.name, validation.value || {}, call.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: tool.name,
          content: wrapToolError(tool.name, message),
        });
        emit({ type: 'tool_result', name: tool.name, ok: false });
        continue;
      }

      const redacted = redactResult(raw, input.dataLevel, input.secrets);
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: tool.name,
        content: wrapToolData(tool.name, redacted),
      });
      emit({ type: 'tool_result', name: tool.name, ok: true });
    }

    if (limitHit) break;
  }

  return { text, messages, usage, toolCalls: calls.length, pendingActions, stop, failure };
}
