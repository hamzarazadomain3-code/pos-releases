/**
 * The tool registry — ONE definition of every tool the assistant may use.
 *
 * The registry is the single source of truth for:
 *   - what the model is told about a tool (the name, the English description,
 *     the JSON schema),
 *   - how risky a tool is (`read` / `write` / `dangerous`),
 *   - who may run it (the app's own role ladder + the existing permission id),
 *   - how its input is validated (strict: a missing field, an extra field, a
 *     wrong type, a NaN, a huge number or a SQL-looking string is REFUSED
 *     before anything touches the database),
 *   - what it does (`execute`), what it would change (`preview`) and whether it
 *     can be undone (`undo`).
 *
 * The implementations are INJECTED: the shared module stays renderer-safe (it
 * must not import a service), and the main process hands in the real
 * implementations that call the app's existing services.
 */
import type {
  AssistantContext,
  AssistantRole,
  AssistantToolDefinition,
  JsonSchema,
  JsonSchemaProperty,
} from './types';

/** What a tool may do. */
export type ToolRisk = 'read' | 'write' | 'dangerous' | 'forbidden';

/** The plain-language preview of what a write tool would change. */
export interface ToolPreview {
  /** One line the owner reads before confirming. */
  summary: string;
  /** The exact before/after of every affected value. */
  details?: { label: string; before?: string | number | null; after?: string | number | null }[];
  /** The rows the change would touch. */
  rows?: unknown[];
}

/** What the main process (or the renderer) hands to the registry. */
export interface ToolImplementation {
  execute(ctx: AssistantContext, input: Record<string, unknown>): unknown | Promise<unknown>;
  preview?(ctx: AssistantContext, input: Record<string, unknown>): ToolPreview | Promise<ToolPreview>;
  undo?(ctx: AssistantContext, receipt: unknown): unknown | Promise<unknown>;
}

export interface ToolValidation {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
}

export interface AssistantTool extends AssistantToolDefinition {
  /** The minimum role on the app's own ladder (the same rule the services use). */
  minRole: AssistantRole;
  /** The existing permission id that guards the same action in the app. */
  requiredPermission: string;
  /** A narrowing on top of `minRole` (when present). */
  allowedRoles?: AssistantRole[];
  validate(input: unknown): ToolValidation;
  /** The implementation (absent for a tool that is declared but not wired yet). */
  impl?: ToolImplementation;
}

/**
 * The tools that must NEVER exist.
 *
 * The registry does not register them, and the test asserts their absence:
 * deleting data, voiding a sale, taking the money, changing the users, the
 * roles, the security settings, the licence, the backups, the assistant's own
 * settings, sending email/SMS/WhatsApp, running SQL or a shell, reading a
 * secret.
 */
export const FORBIDDEN_TOOL_NAMES: string[] = [
  'delete_product',
  'delete_customer',
  'delete_sale',
  'delete_anything',
  'void_sale',
  'complete_sale',
  'finalize_payment',
  'checkout',
  'take_payment',
  'refund',
  'process_refund',
  'create_user',
  'update_user',
  'delete_user',
  'change_roles',
  'change_permissions',
  'change_security_settings',
  'change_password',
  'read_password',
  'licensing',
  'activate_license',
  'backup',
  'restore',
  'change_assistant_settings',
  'send_email',
  'send_sms',
  'send_whatsapp',
  'run_sql',
  'run_shell',
  'exec',
  'read_secrets',
  'read_api_key',
];

// ── the schema validator ───────────────────────────────────────────────────

/** Text that looks like a database command is refused outright. */
const SQL_LIKE = /(\bunion\b\s+\bselect\b|\bdrop\b\s+\btable\b|\binsert\b\s+\binto\b|\bdelete\b\s+\bfrom\b|\bupdate\b\s+\bset\b|;\\s*--|\/\*|--\s*$)/i;

/** The biggest number a tool input may carry. */
export const MAX_INPUT_NUMBER = 1_000_000_000;

function typeMatches(value: unknown, type: JsonSchemaProperty['type']): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return !!value && typeof value === 'object' && !Array.isArray(value);
    default:
      return false;
  }
}

/**
 * Validate an input against a tool's schema.
 *
 * Strict on purpose: an unknown field is a refusal (not a silent ignore), a
 * NaN or an infinite number is a refusal, a huge number is a refusal, and a
 * string that looks like SQL is a refusal.
 */
export function validateAgainstSchema(schema: JsonSchema, input: unknown): ToolValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'The tool input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const allowed = Object.keys(schema.properties);
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      return { ok: false, error: `Unknown field "${key}".` };
    }
  }
  for (const key of schema.required ?? []) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === '') {
      return { ok: false, error: `Missing field "${key}".` };
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return { ok: false, error: `Field "${key}" is not a real number.` };
    }
    if (typeof value === 'number' && Math.abs(value) > MAX_INPUT_NUMBER) {
      return { ok: false, error: `Field "${key}" is too large.` };
    }
    if (!typeMatches(value, prop.type)) {
      return { ok: false, error: `Field "${key}" must be a ${prop.type}.` };
    }
    if (prop.enum && !prop.enum.includes(String(value))) {
      return { ok: false, error: `Field "${key}" must be one of: ${prop.enum.join(', ')}.` };
    }
    if (typeof prop.minimum === 'number' && typeof value === 'number' && value < prop.minimum) {
      return { ok: false, error: `Field "${key}" is too small.` };
    }
    if (typeof prop.maximum === 'number' && typeof value === 'number' && value > prop.maximum) {
      return { ok: false, error: `Field "${key}" is too large.` };
    }
    if (typeof value === 'string') {
      if (value.length > 500) return { ok: false, error: `Field "${key}" is too long.` };
      if (SQL_LIKE.test(value)) {
        return { ok: false, error: `Field "${key}" looks like a database command and was refused.` };
      }
      if (prop.type === 'string' && prop.enum === undefined && /^\s*nan\s*$/i.test(value)) {
        return { ok: false, error: `Field "${key}" is not a real number.` };
      }
    }
    if (prop.type === 'array' && Array.isArray(value) && prop.items) {
      for (const item of value) {
        if (!typeMatches(item, prop.items.type)) {
          return { ok: false, error: `Field "${key}" must be a list of ${prop.items.type}.` };
        }
      }
    }
    out[key] = value;
  }
  return { ok: true, value: out };
}

// ── the tool definitions ───────────────────────────────────────────────────

const emptySchema: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };

function schema(
  properties: Record<string, JsonSchemaProperty>,
  required: string[] = []
): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: ToolRisk;
  minRole: AssistantRole;
  requiredPermission: string;
  allowedRoles?: AssistantRole[];
  write?: boolean;
  /** A stricter check on top of the schema (e.g. "one of these two fields"). */
  extraValidate?: (input: Record<string, unknown>) => string | null;
}

const SPECS: ToolSpec[] = [
  // ── READ ────────────────────────────────────────────────────────────────
  {
    name: 'get_today_summary',
    description:
      "Today's shop summary: today's sales total and bill count, total udhaar (credit) due, the low stock count and today's expenses. Use it for questions like 'how much did we sell today'.",
    inputSchema: emptySchema,
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'view_sales',
  },
  {
    name: 'get_sales_range',
    description:
      'The sales totals for a date range (day by day: bills, subtotal, discount, tax and total). Both dates are YYYY-MM-DD; leave them out for the last 30 days.',
    inputSchema: schema(
      {
        from: { type: 'string', description: 'The first day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'The last day, YYYY-MM-DD.' },
      }
    ),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'view_sales',
  },
  {
    name: 'get_top_products',
    description: 'The best selling products (name, quantity sold and revenue) for a period.',
    inputSchema: schema({
      limit: { type: 'integer', description: 'How many products to return (1-20).', minimum: 1, maximum: 20 },
    }),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'view_sales',
  },
  {
    name: 'get_low_stock',
    description: 'The products that are at or below their low-stock threshold, with the quantity in stock.',
    inputSchema: schema({
      limit: { type: 'integer', description: 'How many products to return (1-50).', minimum: 1, maximum: 50 },
    }),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'view_reports',
  },
  {
    name: 'get_product',
    description:
      'One product by its exact name or its barcode: the price, the cost, the stock and the unit. Give either the name or the barcode.',
    inputSchema: schema({
      name: { type: 'string', description: 'The product name.' },
      barcode: { type: 'string', description: 'The barcode.' },
    }),
    risk: 'read',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
    extraValidate: (input) =>
      !input.name && !input.barcode ? 'Give the product name or its barcode.' : null,
  },
  {
    name: 'get_customer',
    description: 'One customer by name or phone number: the balance, the credit limit and the price level.',
    inputSchema: schema({
      name: { type: 'string', description: 'The customer name.' },
      phone: { type: 'string', description: 'The phone number.' },
    }),
    risk: 'read',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
    extraValidate: (input) =>
      !input.name && !input.phone ? 'Give the customer name or their phone number.' : null,
  },
  {
    name: 'get_customer_balance',
    description: 'The udhaar (credit) balance and the recent payments of one customer.',
    inputSchema: schema({
      name: { type: 'string', description: 'The customer name.' },
      phone: { type: 'string', description: 'The phone number.' },
    }),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'manage_udhaar',
    extraValidate: (input) =>
      !input.name && !input.phone ? 'Give the customer name or their phone number.' : null,
  },
  {
    name: 'list_overdue_customers',
    description: 'The customers whose udhaar is past its due date, with the overdue amount.',
    inputSchema: schema({
      limit: { type: 'integer', description: 'How many customers to return (1-50).', minimum: 1, maximum: 50 },
    }),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'manage_udhaar',
  },
  {
    name: 'get_supplier_payables',
    description: 'The suppliers the shop owes money to, with the payable amount.',
    inputSchema: schema({
      limit: { type: 'integer', description: 'How many suppliers to return (1-50).', minimum: 1, maximum: 50 },
    }),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'manage_purchases',
  },
  {
    name: 'get_shift_status',
    description: 'The current shift: who opened it, when, the cash in the drawer and the bills in the shift.',
    inputSchema: emptySchema,
    risk: 'read',
    minRole: 'cashier',
    requiredPermission: 'manage_shifts',
  },
  {
    name: 'get_returns_summary',
    description: 'The returns and refunds of the last days: how many, the total amount and the top reasons.',
    inputSchema: schema({
      days: { type: 'integer', description: 'How many days to look back (1-90).', minimum: 1, maximum: 90 },
    }),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'process_returns',
  },
  {
    name: 'get_below_cost_products',
    description:
      'The products that were sold below their cost price — the shop loses money on every one of them. Only for a role that may see profit.',
    inputSchema: schema({
      limit: { type: 'integer', description: 'How many products to return (1-50).', minimum: 1, maximum: 50 },
    }),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'view_reports',
  },
  {
    name: 'explain_number',
    description:
      'Break one number down into its parts (for example today\'s sale: the bills, the average bill, the discount and tax). Only for a role that may see profit.',
    inputSchema: schema(
      {
        metric: {
          type: 'string',
          description: 'Which number to explain.',
          enum: ['today_sales', 'today_bills', 'udhaar_due', 'low_stock', 'today_expenses', 'net_profit'],
        },
        days: { type: 'integer', description: 'For a range metric, how many days back (1-90).', minimum: 1, maximum: 90 },
      },
      ['metric']
    ),
    risk: 'read',
    minRole: 'manager',
    requiredPermission: 'view_reports',
  },
  {
    name: 'search_help',
    description:
      'Search the in-app help: the step-by-step guides and the FAQ. Works without internet and without an AI key.',
    inputSchema: schema(
      { query: { type: 'string', description: 'What the user wants to know, in their own words.' } },
      ['query']
    ),
    risk: 'read',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
  },
  // ── NAVIGATION ──────────────────────────────────────────────────────────
  {
    name: 'open_page',
    description: 'Open one page of the app (for example billing, inventory, udhaar). Only pages the user may open.',
    inputSchema: schema(
      { route: { type: 'string', description: 'The page id, for example "billing" or "inventory".' } },
      ['route']
    ),
    risk: 'read',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
  },
  {
    name: 'start_guide',
    description: 'Start a step-by-step guide that highlights the controls on the screen (it never clicks for the user).',
    inputSchema: schema(
      { guideId: { type: 'string', description: 'The guide id, for example "make_a_bill".' } },
      ['guideId']
    ),
    risk: 'read',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
  },
  {
    name: 'highlight',
    description: 'Highlight one control on the current screen and say what to do with it.',
    inputSchema: schema(
      { elementId: { type: 'string', description: 'The element id of the control.' } },
      ['elementId']
    ),
    risk: 'read',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
  },
  // ── WRITE (they only PROPOSE — the owner confirms) ──────────────────────
  {
    name: 'create_customer',
    description: 'Add a new customer to the udhaar list.',
    inputSchema: schema(
      {
        name: { type: 'string', description: 'The customer name.' },
        phone: { type: 'string', description: 'The phone number.' },
        address: { type: 'string', description: 'The address.' },
      },
      ['name']
    ),
    risk: 'write',
    minRole: 'manager',
    requiredPermission: 'manage_udhaar',
    allowedRoles: ['owner', 'manager'],
    write: true,
  },
  {
    name: 'set_customer_discount',
    description: 'Set the standing discount of a customer.',
    inputSchema: schema(
      {
        customer: { type: 'string', description: 'The customer name.' },
        discount: { type: 'number', description: 'The discount.', minimum: 0, maximum: 100 },
        discountType: { type: 'string', description: 'percent or amount.', enum: ['percent', 'amount'] },
      },
      ['customer', 'discount']
    ),
    risk: 'write',
    minRole: 'manager',
    requiredPermission: 'manage_udhaar',
    allowedRoles: ['owner', 'manager'],
    write: true,
  },
  {
    name: 'add_to_bill',
    description: 'Add a product to the bill that is open on the billing screen. It never takes the payment.',
    inputSchema: schema(
      {
        product: { type: 'string', description: 'The product name or barcode.' },
        qty: { type: 'number', description: 'How much to add.', minimum: 0.001, maximum: 100000 },
        unit: { type: 'string', description: 'The unit, when the product is sold by weight.' },
      },
      ['product']
    ),
    risk: 'write',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
    write: true,
  },
  {
    name: 'hold_bill',
    description: 'Hold the bill that is open on the billing screen, so it can be picked up later.',
    inputSchema: schema({ label: { type: 'string', description: 'A short label for the held bill.' } }),
    risk: 'write',
    minRole: 'cashier',
    requiredPermission: 'view_sales',
    write: true,
  },
  {
    name: 'create_expense_draft',
    description: 'Save a draft of an expense for the owner to review.',
    inputSchema: schema(
      {
        amount: { type: 'number', description: 'The amount.', minimum: 0.01, maximum: 100000000 },
        category: { type: 'string', description: 'The expense category.' },
        note: { type: 'string', description: 'What the expense was for.' },
        date: { type: 'string', description: 'The date, YYYY-MM-DD.' },
      },
      ['amount']
    ),
    risk: 'write',
    minRole: 'manager',
    requiredPermission: 'manage_expenses',
    allowedRoles: ['owner', 'manager'],
    write: true,
  },
  {
    name: 'create_promotion_draft',
    description: 'Save a draft of a promotion. It stays inactive until the owner activates it.',
    inputSchema: schema(
      {
        name: { type: 'string', description: 'The promotion name.' },
        product: { type: 'string', description: 'The product the promotion is for.' },
        percent: { type: 'number', description: 'The discount percent.', minimum: 0, maximum: 100 },
        startsOn: { type: 'string', description: 'The first day, YYYY-MM-DD.' },
        endsOn: { type: 'string', description: 'The last day, YYYY-MM-DD.' },
      },
      ['name']
    ),
    risk: 'write',
    minRole: 'manager',
    requiredPermission: 'manage_promotions',
    allowedRoles: ['owner', 'manager'],
    write: true,
  },
  {
    name: 'stock_adjustment',
    description:
      'Change the stock quantity of a product (for example after a physical count). A reason is required and the owner must confirm.',
    inputSchema: schema(
      {
        product: { type: 'string', description: 'The product name or barcode.' },
        changeQty: { type: 'number', description: 'How much to add (or subtract, with a minus).' },
        reason: { type: 'string', description: 'Why the stock is being changed.' },
      },
      ['product', 'changeQty', 'reason']
    ),
    risk: 'dangerous',
    minRole: 'manager',
    requiredPermission: 'edit_products',
    allowedRoles: ['owner', 'manager'],
    write: true,
  },
  {
    name: 'update_product_price',
    description:
      'Change the sale price or the cost price of a product. The owner must confirm, and the old and the new price are both shown.',
    inputSchema: schema(
      {
        product: { type: 'string', description: 'The product name or barcode.' },
        salePrice: { type: 'number', description: 'The new sale price.', minimum: 0, maximum: 100000000 },
        costPrice: { type: 'number', description: 'The new cost price.', minimum: 0, maximum: 100000000 },
      },
      ['product']
    ),
    risk: 'dangerous',
    minRole: 'manager',
    requiredPermission: 'edit_products',
    allowedRoles: ['owner', 'manager'],
    write: true,
  },
];

function buildTool(spec: ToolSpec): AssistantTool {
  const tool: AssistantTool = {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    risk: spec.risk,
    minRole: spec.minRole,
    requiredPermission: spec.requiredPermission,
    allowedRoles: spec.allowedRoles,
    write: spec.write ?? (spec.risk === 'write' || spec.risk === 'dangerous'),
    validate(input: unknown): ToolValidation {
      const base = validateAgainstSchema(spec.inputSchema, input);
      if (!base.ok) return base;
      const value = base.value as Record<string, unknown>;
      if (spec.extraValidate) {
        const problem = spec.extraValidate(value);
        if (problem) return { ok: false, error: problem };
      }
      return { ok: true, value };
    },
  };
  return tool;
}

/** Every tool definition, in registry order (the model sees this order). */
export const TOOL_SPECS: AssistantTool[] = SPECS.map(buildTool);

/** Every tool's name — the registry is the only place a tool name exists. */
export const TOOL_NAMES: string[] = TOOL_SPECS.map((t) => t.name);

/** The tool with this name, if it exists. */
export function toolByName(name: string): AssistantTool | undefined {
  return TOOL_SPECS.find((t) => t.name === name);
}

/**
 * Build the live registry: the definitions + the implementations the main
 * process (or the renderer) hands in.
 */
export function buildToolRegistry(implementations: Record<string, ToolImplementation> = {}): AssistantTool[] {
  return TOOL_SPECS.map((tool) => {
    const impl = implementations[tool.name];
    if (!impl) return tool;
    return { ...tool, impl };
  });
}

/**
 * May this role run this tool?
 *
 * The app enforces its permissions by ROLE RANK (`can('manager')` in the
 * services), so the registry uses the same ladder — the permission id names
 * the existing permission that guards the same action, and `allowedRoles` is a
 * narrowing on top.
 */
export function toolAllowedForRole(tool: AssistantTool, role: string | null | undefined): boolean {
  if (!role) return false;
  const rank: Record<AssistantRole, number> = { cashier: 1, manager: 2, owner: 3 };
  const userRank = rank[role as AssistantRole];
  if (!userRank) return false;
  if (userRank < rank[tool.minRole]) return false;
  if (tool.allowedRoles && !tool.allowedRoles.includes(role as AssistantRole)) return false;
  return true;
}

/** The tools a role may use. */
export function toolsForRole(tools: AssistantTool[], role: string | null | undefined): AssistantTool[] {
  return tools.filter((t) => toolAllowedForRole(t, role));
}

/** The tools a role may use, as the model sees them (no implementation). */
export function toolDefinitionsForRole(
  tools: AssistantTool[],
  role: string | null | undefined
): AssistantToolDefinition[] {
  return toolsForRole(tools, role).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    risk: t.risk,
    requiredPermission: t.requiredPermission,
    allowedRoles: t.allowedRoles,
    write: t.write,
  }));
}

/** Is this a tool that changes data? */
export function isWriteTool(tool: AssistantTool): boolean {
  return tool.risk === 'write' || tool.risk === 'dangerous';
}
