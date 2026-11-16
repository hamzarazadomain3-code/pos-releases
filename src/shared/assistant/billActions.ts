/**
 * The billing helper commands — the pure model.
 *
 * The OPEN BILL lives in the renderer (the Billing screen owns the cart), so a
 * billing action cannot be finished in the main process: the tool resolves the
 * product through the app's own inventory service and then hands the renderer a
 * COMMAND. The renderer applies that command with the very same code the
 * Billing buttons use (`addProduct` / `doHold`), so there is never a second
 * way of adding a line or of holding a bill.
 *
 * The command is the ONLY thing that crosses the line, and it is pure data —
 * no function, no class, nothing the database cannot store as JSON.
 */
export type AssistantBillCommand =
  | {
      kind: 'add_to_bill';
      productId: number;
      productName: string;
      qty: number;
      unit?: string;
    }
  | { kind: 'hold_bill'; label: string };

/** The tools that end in a billing command. */
export const BILL_COMMAND_TOOLS = ['add_to_bill', 'hold_bill'] as const;

/** A qty the assistant may ask for (the same bounds the registry allows). */
export function billQty(value: unknown): number {
  const qty = Number(value ?? 1);
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  return Math.min(100000, qty);
}

/** The command for a confirmed tool call (null when the tool is not a billing one). */
export function billCommandFor(tool: string, args: Record<string, unknown>): AssistantBillCommand | null {
  if (tool === 'add_to_bill') {
    const productId = Number(args.productId ?? 0);
    if (!Number.isFinite(productId) || productId <= 0) return null;
    const command: AssistantBillCommand = {
      kind: 'add_to_bill',
      productId,
      productName: String(args.productName ?? '').trim(),
      qty: billQty(args.qty),
    };
    const unit = String(args.unit ?? '').trim();
    return unit ? { ...command, unit } : command;
  }
  if (tool === 'hold_bill') {
    return { kind: 'hold_bill', label: String(args.label ?? '').trim() || 'Held bill' };
  }
  return null;
}

/** Is this value a billing command? (The value comes back out of the database.) */
export function isBillCommand(value: unknown): value is AssistantBillCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<AssistantBillCommand>;
  if (command.kind === 'add_to_bill') {
    return (
      typeof command.productId === 'number' &&
      Number.isFinite(command.productId) &&
      command.productId > 0 &&
      typeof command.qty === 'number' &&
      Number.isFinite(command.qty) &&
      command.qty > 0
    );
  }
  if (command.kind === 'hold_bill') return typeof command.label === 'string';
  return false;
}

/** The command inside a tool result (the confirmed action's stored result). */
export function billCommandFromResult(result: unknown): AssistantBillCommand | null {
  if (!result || typeof result !== 'object') return null;
  const command = (result as { billCommand?: unknown }).billCommand;
  return isBillCommand(command) ? command : null;
}

/** One line about what the command will do. */
export function billCommandText(command: AssistantBillCommand): string {
  if (command.kind === 'add_to_bill') {
    return `Add ${command.qty} × ${command.productName} to the open bill`;
  }
  return `Hold the open bill as "${command.label}"`;
}
