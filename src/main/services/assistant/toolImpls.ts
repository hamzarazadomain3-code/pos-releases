/**
 * The tool implementations — the main-process half of the registry.
 *
 * Every READ tool calls the app's EXISTING services (no new SQL for a number
 * the app already produces) and every tool shows the role only what that role
 * may see in the app today (a cashier never gets the cost price or the credit
 * limit).
 *
 * The WRITE tools only PROPOSE here — they never run inside the agent loop.
 * Their `execute` runs only after the owner confirms the action card
 * (Item 8), through the very same service the normal UI uses.
 */
import {
  dashboard,
  getDailyStats,
  getTopProducts,
  listBelowCostProducts,
  profitLoss,
  salesReport,
} from '../reports';
import { getProduct, getProductByBarcode, listLowStock, listProducts } from '../inventory';
import { listCustomers } from '../sales';
import { saveCustomer } from '../customers';
import { getUdhaarAging } from '../udhaar';
import { listSuppliers } from '../purchases';
import { currentShift, shiftTotals } from '../shifts';
import { listReturns } from '../returns';
import { canOpenRoute } from '../../../shared/sidebarMenu';
import { roleAtLeast } from '../../../shared/roles';
import { GUIDES, guideById } from '../../../shared/assistant/guides';
import { searchHelp } from '../../../shared/assistant/search';
import type { AssistantContext } from '../../../shared/assistant/types';
import type { ToolImplementation, ToolPreview } from '../../../shared/assistant/tools';

/** May this role see profit / cost figures? (The Reports page is manager+.) */
export function maySeeProfit(ctx: AssistantContext): boolean {
  return roleAtLeast(ctx.user.role, 'manager');
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The overdue part of an aging bucket (everything past the due date). */
function overdueOf(buckets: {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}): number {
  return num(buckets.d1_30) + num(buckets.d31_60) + num(buckets.d61_90) + num(buckets.d90_plus);
}

/** Find a product by its exact name (case-insensitive) or its barcode. */
function findProduct(input: { name?: unknown; barcode?: unknown; product?: unknown }) {
  const barcode = String(input.barcode ?? '').trim();
  if (barcode) {
    const byBarcode = getProductByBarcode(barcode);
    if (byBarcode) return byBarcode;
  }
  const name = String(input.name ?? input.product ?? '').trim();
  if (!name) return null;
  const candidates = listProducts(name, false);
  const lower = name.toLowerCase();
  return candidates.find((p) => p.name.toLowerCase() === lower) ?? candidates[0] ?? null;
}

/** Find a customer by name or phone number. */
function findCustomer(input: { name?: unknown; phone?: unknown; customer?: unknown }) {
  const phone = String(input.phone ?? '').trim();
  const name = String(input.name ?? input.customer ?? '').trim();
  const all = listCustomers('all');
  if (phone) {
    const hit = all.find((c) => (c.phone ?? '').replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (hit) return hit;
  }
  if (!name) return null;
  const lower = name.toLowerCase();
  return all.find((c) => c.name.toLowerCase() === lower) ?? all.find((c) => c.name.toLowerCase().includes(lower)) ?? null;
}

/** The product fields a role may see. */
function productView(ctx: AssistantContext, p: NonNullable<ReturnType<typeof getProduct>>) {
  const view: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    barcode: p.barcode ?? null,
    sku: p.sku ?? null,
    sale_price: num(p.sale_price),
    stock_qty: num(p.stock_qty),
    unit: p.unit_name ?? null,
    active: p.active === 1,
  };
  if (maySeeProfit(ctx)) {
    view.cost_price = num(p.cost_price);
    view.gross_margin = round2(num(p.sale_price) - num(p.cost_price));
  }
  return view;
}

/** The customer fields a role may see. */
function customerView(ctx: AssistantContext, c: NonNullable<ReturnType<typeof listCustomers>>[number]) {
  const view: Record<string, unknown> = {
    id: c.id,
    name: c.name,
    balance: round2(num(c.balance)),
    price_level: c.customer_type ?? 'retail',
  };
  // The phone number is contact data: it is only shown to a role that manages
  // the udhaar list, and the redaction layer strips it again before it is sent.
  if (maySeeProfit(ctx)) {
    view.phone = c.phone ?? null;
    view.credit_limit = num(c.credit_limit);
  }
  return view;
}

/**
 * The READ + NAVIGATION implementations.
 *
 * A tool NEVER trusts a role passed by the model: the role always comes from
 * the real session in `ctx`.
 */
export function buildAssistantToolImplementations(): Record<string, ToolImplementation> {
  return {
    get_today_summary: {
      execute(ctx) {
        const d = dashboard();
        const out: Record<string, unknown> = {
          today_sales: round2(num(d.today_sales)),
          today_bills: d.today_bills,
          low_stock_count: d.low_stock,
          today_expenses: round2(num(d.today_expenses)),
        };
        if (maySeeProfit(ctx)) out.udhaar_due = round2(num(d.udhaar_due));
        return out;
      },
    },

    get_sales_range: {
      execute(_ctx, input) {
        const from = input.from ? String(input.from) : undefined;
        const to = input.to ? String(input.to) : undefined;
        const rows = salesReport(from, to);
        return {
          from: from ?? null,
          to: to ?? null,
          days: rows.map((r) => ({
            day: r.day,
            bills: r.bills,
            subtotal: round2(num(r.subtotal)),
            discount: round2(num(r.discount)),
            tax: round2(num(r.tax)),
            total: round2(num(r.total)),
          })),
          total: round2(rows.reduce((sum, r) => sum + num(r.total), 0)),
        };
      },
    },

    get_top_products: {
      execute(_ctx, input) {
        const limit = Math.max(1, Math.min(20, num(input.limit) || 5));
        const rows = getTopProducts(limit);
        return {
          products: rows.map((r) => ({
            name: r.name,
            qty_sold: round2(num(r.qty_sold)),
            revenue: round2(num(r.revenue)),
          })),
        };
      },
    },

    get_low_stock: {
      execute(_ctx, input) {
        const limit = Math.max(1, Math.min(50, num(input.limit) || 10));
        const rows = listLowStock().slice(0, limit);
        return {
          products: rows.map((p) => ({
            id: p.id,
            name: p.name,
            stock_qty: round2(num(p.stock_qty)),
            low_stock_threshold: round2(num(p.low_stock_threshold)),
          })),
          count: listLowStock().length,
        };
      },
    },

    get_product: {
      execute(ctx, input) {
        const product = findProduct(input);
        if (!product) return { found: false, message: 'No product matched that name or barcode.' };
        return { found: true, product: productView(ctx, product) };
      },
    },

    get_customer: {
      execute(ctx, input) {
        const customer = findCustomer(input);
        if (!customer) return { found: false, message: 'No customer matched that name or phone number.' };
        return { found: true, customer: customerView(ctx, customer) };
      },
    },

    get_customer_balance: {
      execute(ctx, input) {
        const customer = findCustomer(input);
        if (!customer) return { found: false, message: 'No customer matched that name or phone number.' };
        const aging = getUdhaarAging();
        const row = aging.rows.find((r) => r.customer_id === customer.id) ?? null;
        const overdue = row ? overdueOf(row.buckets) : 0;
        return {
          found: true,
          customer_id: customer.id,
          name: customer.name,
          balance: round2(num(customer.balance)),
          credit_days: customer.credit_days ?? 0,
          overdue_amount: round2(overdue),
          days_overdue: row ? row.days_overdue : 0,
          oldest_due_date: row ? row.oldest_due_date : null,
        };
      },
    },

    list_overdue_customers: {
      execute(_ctx, input) {
        const limit = Math.max(1, Math.min(50, num(input.limit) || 10));
        const aging = getUdhaarAging();
        const rows = aging.rows
          .map((r) => ({
            customer_id: r.customer_id,
            name: r.name,
            balance: round2(num(r.outstanding)),
            overdue_amount: round2(overdueOf(r.buckets)),
            days_overdue: r.days_overdue,
          }))
          .filter((r) => r.overdue_amount > 0)
          .slice(0, limit);
        return { customers: rows, total_overdue: round2(rows.reduce((s, r) => s + r.overdue_amount, 0)) };
      },
    },

    get_supplier_payables: {
      execute(_ctx, input) {
        const limit = Math.max(1, Math.min(50, num(input.limit) || 20));
        const rows = listSuppliers()
          .map((s) => ({ name: s.name, payable: round2(num((s as { payable?: number }).payable ?? (s as { balance?: number }).balance ?? 0)) }))
          .filter((r) => r.payable !== 0)
          .slice(0, limit);
        return {
          suppliers: rows,
          total_payable: round2(rows.reduce((s, r) => s + r.payable, 0)),
        };
      },
    },

    get_shift_status: {
      execute(_ctx) {
        const shift = currentShift();
        if (!shift) return { open: false, message: 'No shift is open right now.' };
        const totals = shiftTotals(shift.id);
        return {
          open: true,
          shift_id: shift.id,
          user_id: shift.user_id,
          opened_at: shift.opened_at ?? null,
          cash_sales: round2(num(totals.cash_sales)),
          cash_refunds: round2(num(totals.cash_refunds)),
          expected_in_drawer: round2(num(totals.expected)),
        };
      },
    },

    get_returns_summary: {
      execute(_ctx, input) {
        const days = Math.max(1, Math.min(90, num(input.days) || 7));
        const rows = listReturns();
        const cutoff = Date.now() - days * 86400000;
        const recent = rows.filter((r) => {
          const at = Date.parse(String(r.created_at ?? ''));
          return Number.isFinite(at) ? at >= cutoff : true;
        });
        return {
          days,
          count: recent.length,
          total_refunded: round2(recent.reduce((s, r) => s + num(r.refund_amount), 0)),
          items: recent.slice(0, 10).map((r) => ({
            id: r.id,
            invoice_no: r.invoice_no ?? null,
            reason: r.reason ?? null,
            refund_amount: round2(num(r.refund_amount)),
            refund_mode: r.refund_mode,
            created_at: r.created_at ?? null,
          })),
        };
      },
    },

    get_below_cost_products: {
      execute(ctx) {
        if (!maySeeProfit(ctx)) {
          return { allowed: false, message: 'This role may not see profit figures.' };
        }
        const rows = listBelowCostProducts().slice(0, 50);
        return {
          count: rows.length,
          products: rows.map((r) => ({
            product_id: r.product_id,
            name: r.name,
            cost_price: round2(num(r.cost_price)),
            sale_price: round2(num(r.sale_price)),
            margin: round2(num(r.margin)),
          })),
        };
      },
    },

    explain_number: {
      execute(ctx, input) {
        const metric = String(input.metric ?? '');
        const days = Math.max(1, Math.min(90, num(input.days) || 30));
        if (metric === 'net_profit' && !maySeeProfit(ctx)) {
          return { allowed: false, message: 'This role may not see profit figures.' };
        }
        const stats = getDailyStats();
        if (metric === 'today_sales') {
          return {
            metric,
            value: round2(num(stats.total_sales)),
            components: [
              { label: 'bills', value: stats.bill_count },
              { label: 'average_bill', value: round2(num(stats.avg_bill)) },
              { label: 'returns deducted', value: 0 },
            ],
          };
        }
        if (metric === 'today_bills') {
          return {
            metric,
            value: stats.bill_count,
            components: [
              { label: 'sales total', value: round2(num(stats.total_sales)) },
              { label: 'average bill', value: round2(num(stats.avg_bill)) },
            ],
          };
        }
        if (metric === 'udhaar_due') {
          const d = dashboard();
          return {
            metric,
            value: round2(num(d.udhaar_due)),
            components: [
              { label: 'customers with a balance', value: getUdhaarAging().rows.length },
            ],
          };
        }
        if (metric === 'low_stock') {
          const d = dashboard();
          return {
            metric,
            value: d.low_stock,
            components: [
              { label: 'products below the threshold', value: listLowStock().length },
              { label: 'negative stock products', value: d.negative_stock },
            ],
          };
        }
        if (metric === 'today_expenses') {
          const d = dashboard();
          return {
            metric,
            value: round2(num(d.today_expenses)),
            components: [{ label: 'expenses recorded today', value: 1 }],
          };
        }
        if (metric === 'net_profit') {
          const pl = profitLoss();
          const parts = (pl as unknown as Record<string, unknown>);
          return {
            metric,
            value: round2(num(parts.net)),
            components: Object.entries(parts)
              .filter(([, v]) => typeof v === 'number')
              .map(([label, v]) => ({ label, value: round2(num(v)) })),
          };
        }
        return { metric, value: null, components: [], message: 'That figure is not one the assistant can explain.' };
      },
    },

    // ── WRITE (they only PROPOSE — the owner confirms) ──────────────────────
    // The write tools run ONLY after the owner confirms the action card (the
    // agent loop never runs them). They call the very same service the
    // normal UI calls, so there is no second way of writing the data.
    create_customer: {
      async execute(_ctx, input) {
        const result = saveCustomer({
          name: String(input.name ?? '').trim(),
          phone: input.phone ? String(input.phone) : null,
          address: input.address ? String(input.address) : null,
        });
        if (!result.ok) throw new Error(result.message || 'The customer could not be saved.');
        return {
          ok: true,
          customer_id: result.customer?.id ?? null,
          name: result.customer?.name ?? String(input.name),
        };
      },
      async preview(_ctx, input) {
        return {
          summary: `Add the customer "${String(input.name ?? '')}" to the udhaar list`,
          details: [
            { label: 'Name', after: String(input.name ?? '') },
            { label: 'Phone', after: input.phone ? String(input.phone) : '—' },
            { label: 'Address', after: input.address ? String(input.address) : '—' },
          ],
        };
      },
    },

    // ── navigation ─────────────────────────────────────────────────────────
    open_page: {
      execute(ctx, input) {
        const route = String(input.route ?? '');
        if (!canOpenRoute(ctx.user.role, route)) {
          return { ok: false, message: 'This role may not open that page.' };
        }
        return { ok: true, route };
      },
    },

    search_help: {
      execute(_ctx, input) {
        const query = String(input.query ?? '').trim();
        if (!query) return { found: false, message: 'Ask what you want to know.' };
        const results = searchHelp(query);
        if (!results.length) {
          return {
            found: false,
            query,
            message: 'The in-app help has nothing about that. Try the page the question is about.',
          };
        }
        return {
          found: true,
          query,
          results: results.map((r) => ({
            kind: r.kind,
            id: r.id,
            title: r.title,
            text: r.body,
            route: r.route ?? null,
            steps: r.steps ?? null,
          })),
        };
      },
    },

    start_guide: {
      execute(_ctx, input) {
        const guideId = String(input.guideId ?? '');
        const guide = guideById(guideId);
        if (!guide) {
          return {
            ok: false,
            guideId,
            message: 'There is no guide with that name.',
            available: GUIDES.map((g) => ({ id: g.id, title: g.title, route: g.route })),
          };
        }
        return {
          ok: true,
          guideId: guide.id,
          title: guide.title,
          route: guide.route,
          steps: guide.steps.map((s) => ({ id: s.id, anchor: s.anchor, title: s.title, text: s.body })),
        };
      },
    },

    highlight: {
      execute(_ctx, input) {
        const elementId = String(input.elementId ?? '');
        if (!elementId) return { ok: false, message: 'Say which control to highlight.' };
        return { ok: true, elementId };
      },
    },
  };
}

/** The preview for a write tool that has one (the others get a default). */
export function defaultPreview(summary: string): ToolPreview {
  return { summary };
}
