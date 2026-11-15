/**
 * The MockProvider — a scripted provider adapter.
 *
 * It is the ONLY provider the tests use: no test ever opens a socket to a real
 * LLM. The "Test connection" button in Settings uses the real adapter; the
 * scripted provider proves the plumbing (tool selection, limits, redaction)
 * without a network.
 */
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from './types';

export interface MockTurn {
  /** When set, this turn only answers a request whose text contains it. */
  match?: string;
  /** A plain text answer. */
  text?: string;
  /** Tool calls the model asks for. */
  toolCalls?: ProviderResponse['toolCalls'];
  usage?: { inputTokens: number; outputTokens: number };
  /** Throw instead of answering — used for the retry / timeout tests. */
  error?: Error;
  /** The most flexible form: build the answer from the request. */
  respond?: (request: ProviderRequest, callIndex: number) => ProviderResponse | Promise<ProviderResponse>;
}

export class MockProvider implements ProviderAdapter {
  readonly id = 'mock';
  /** Every request the provider received (the tests assert on these). */
  readonly requests: ProviderRequest[] = [];
  private callIndex = 0;

  constructor(private readonly turns: MockTurn[] = []) {}

  /** How many times the provider was called. */
  get callCount(): number {
    return this.callIndex;
  }

  async send(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(request);
    const index = this.callIndex++;
    const flat = request.messages.map((m) => m.content).join('\n');
    // A `match` wins, then the scripted turn for this call, then the last one.
    const turn =
      this.turns.find((t) => (t.match ? flat.includes(t.match) : false)) ??
      this.turns[index] ??
      this.turns[this.turns.length - 1];
    if (!turn) {
      return { text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn' };
    }
    if (turn.error) throw turn.error;
    if (turn.respond) return turn.respond(request, index);
    return {
      text: turn.text ?? '',
      toolCalls: turn.toolCalls ?? [],
      usage: turn.usage ?? { inputTokens: 10, outputTokens: 10 },
      stopReason: (turn.toolCalls ?? []).length > 0 ? 'tool_use' : 'end_turn',
    };
  }
}

/** A provider that always fails with the given error (the offline / 401 tests). */
export function failingProvider(error: Error): MockProvider {
  return new MockProvider([{ error }]);
}

/**
 * A provider that fails the first `times` calls and then answers — the retry
 * test.
 */
export function flakyProvider(times: number, text: string): MockProvider {
  let seen = 0;
  return new MockProvider([
    {
      respond: () => {
        seen++;
        if (seen <= times) throw new Error('temporary provider failure');
        return { text, toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'end_turn' };
      },
    },
  ]);
}
