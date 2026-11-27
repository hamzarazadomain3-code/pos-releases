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
import { todayLocal } from '../../utils/timezone';
import {
  dashboard,
  getDailyStats,
  getTopProducts,
  listBelowCostProducts,
  profitLoss,
  salesReport,
} from '../reports';
import { getProduct, getProductByBarcode, listLowStock, listProducts, adjustStock, updateProduct } from '../inventory';
import { listCustomers } from '../sales';
import { saveCustomer } from '../customers';
import { getUdhaarAging, getUdhaarLedger } from '../udhaar';
import { listSuppliers } from '../purchases';
import { currentShift, shiftTotals } from '../shifts';
import { listReturns } from '../returns';
import { createExpense, listCategories, updateExpense } from '../expenses';
import { createPromotion } from '../promotions';
import { makeMoney, printCurrency } from '../printDocs';
import { canOpenRoute } from '../../../shared/sidebarMenu';
import { roleAtLeast } from '../../../shared/roles';
import { GUIDES, guideById } from '../../../shared/assistant/guides';
import { billQty } from '../../../shared/assistant/billActions';
import { searchHelp } from '../../../shared/assistant/search';
import type { AssistantContext } from '../../../shared/assistant/types';
import type { ToolImplementation, ToolPreview } from '../../../shared/assistant/tools';
import type { Customer, CustomerInput, Product, ProductInput } from '../../../shared/types';

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

/** A date the app accepts (YYYY-MM-DD) — anything else is refused. */
function dateOnly(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

/** Today, in the shop's own date format. */
function todayIso(): string {
  return todayLocal();
}

/**
 * The customer's own profile, so changing ONE field keeps every other one.
 *
 * `saveCustomer` writes the WHOLE profile, so the assistant hands the service
 * the profile it found and changes only the discount. The opening balance lives
 * in the ledger (it is the customer's own money), so it is read back from there
 * — otherwise the balance would move.
 */
function customerProfileInput(customer: Customer, openingBalance: number): CustomerInput {
  return {
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    urdu_name: customer.urdu_name ?? null,
    customer_type: customer.customer_type ?? null,
    business_name: customer.business_name ?? null,
    contact_person: customer.contact_person ?? null,
    photo: customer.photo ?? null,
    status: customer.status ?? null,
    customer_code: customer.customer_code ?? null,
    group_name: customer.group_name ?? null,
    tags: customer.tags ?? null,
    phone_alt: customer.phone_alt ?? null,
    whatsapp: customer.whatsapp ?? null,
    email: customer.email ?? null,
    city: customer.city ?? null,
    area: customer.area ?? null,
    maps_link: customer.maps_link ?? null,
    message_language: customer.message_language ?? null,
    cnic: customer.cnic ?? null,
    ntn: customer.ntn ?? null,
    drug_licence: customer.drug_licence ?? null,
    guarantor: customer.guarantor ?? null,
    guarantor_phone: customer.guarantor_phone ?? null,
    credit_limit: num(customer.credit_limit),
    credit_days: num(customer.credit_days),
    price_level: customer.price_level ?? null,
    default_discount_pct: num(customer.default_discount_pct),
    discount_type: customer.discount_type ?? 'percent',
    discount_min_bill: num(customer.discount_min_bill),
    credit_action: customer.credit_action ?? null,
    max_single_bill: num(customer.max_single_bill),
    opening_balance: openingBalance,
    opening_balance_as_of: customer.opening_balance_as_of ?? null,
    notes: customer.notes ?? null,
    birthday: customer.birthday ?? null,
    anniversary: customer.anniversary ?? null,
    reminder_freq: customer.reminder_freq ?? null,
  };
}

/** The customer's opening balance (the ledger's own row). */
function customerOpeningBalance(customerId: number): number {
  const ledger = getUdhaarLedger(customerId);
  const row = ledger.rows.find((r) => r.type === 'opening_balance');
  return row ? round2(num(row.amount)) : 0;
}

/** The product's own fields, so a price change keeps everything else. */
function productProfileInput(product: Product): ProductInput {
  return {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    category_id: product.category_id,
    unit_id: product.unit_id,
    cost_price: num(product.cost_price),
    sale_price: num(product.sale_price),
    wholesale_price: product.wholesale_price,
    shelf_location: product.shelf_location,
    low_stock_threshold: num(product.low_stock_threshold),
    tax_rate: num(product.tax_rate),
    expiry_date: product.expiry_date,
    image: product.image ?? null,
    net_weight: product.net_weight ?? null,
    is_loose: product.is_loose ?? 0,
    is_test: product.is_test ?? 0,
    mfg_date: product.mfg_date ?? null,
    batch_no: product.batch_no ?? null,
  };
}

/** A discount as the owner reads it (a percent or a fixed amount). */
function discountText(value: number, type: string | null | undefined): string {
  if (type === 'fixed') return `${round2(num(value))} (a fixed amount)`;
  return `${round2(num(value))}%`;
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

    // ── the BILLING helpers (the open bill lives in the renderer) ───────────
    // The cart belongs to the Billing screen, so these two tools resolve what
    // they can in the main process (the product, through the app's own
    // inventory service) and hand the renderer a COMMAND. The renderer then
    // applies it with the same `addProduct` / `doHold` the Billing buttons
    // use — there is no second way of touching the open bill.
    add_to_bill: {
      async execute(_ctx, input) {
        const product = findProduct(input);
        if (!product) throw new Error('No product matched that name or barcode.');
        const qty = billQty(input.qty);
        const unit = String(input.unit ?? '').trim();
        return {
          ok: true,
          product_id: product.id,
          name: product.name,
          qty,
          sale_price: num(product.sale_price),
          billCommand: {
            kind: 'add_to_bill' as const,
            productId: product.id,
            productName: product.name,
            qty,
            ...(unit ? { unit } : {}),
          },
        };
      },
      async preview(_ctx, input) {
        const product = findProduct(input);
        const qty = billQty(input.qty);
        const money = makeMoney(printCurrency());
        return {
          summary: `Add ${qty} × "${product?.name ?? String(input.product ?? '')}" to the open bill`,
          details: [
            { label: 'Product', after: product?.name ?? String(input.product ?? '') },
            { label: 'Qty', after: String(qty) },
            { label: 'Price', after: product ? money(num(product.sale_price)) : '—' },
            { label: 'Unit', after: String(input.unit ?? product?.unit_name ?? 'pcs') },
          ],
        };
      },
    },
    hold_bill: {
      async execute(_ctx, input) {
        const label = String(input.label ?? '').trim() || 'Held bill';
        return {
          ok: true,
          label,
          billCommand: { kind: 'hold_bill' as const, label },
        };
      },
      async preview(_ctx, input) {
        const label = String(input.label ?? '').trim() || 'Held bill';
        return {
          summary: `Hold the open bill as "${label}"`,
          details: [{ label: 'Label', after: label }],
        };
      },
    },

    // ── the BACK-OFFICE helpers (the app's own services) ────────────────────
    // Every one of them writes through the very same service the normal screen
    // uses, so there is never a second way of changing a customer, an expense,
    // a promotion, the stock or a price.
    set_customer_discount: {
      async execute(_ctx, input) {
        const customer = findCustomer(input);
        if (!customer) throw new Error('No customer matched that name or phone number.');
        const discount = Math.max(0, round2(num(input.discount)));
        // The registry says "percent" or "amount"; the app calls a fixed amount
        // "fixed".
        const discountType = input.discountType === 'amount' ? 'fixed' : 'percent';
        const result = saveCustomer(
          {
            ...customerProfileInput(customer, customerOpeningBalance(customer.id)),
            default_discount_pct: discount,
            discount_type: discountType,
          },
          customer.id
        );
        if (!result.ok) throw new Error(result.message || 'The discount could not be saved.');
        return {
          ok: true,
          customer_id: customer.id,
          name: customer.name,
          discount,
          discountType,
        };
      },
      async preview(_ctx, input) {
        const customer = findCustomer(input);
        const discount = Math.max(0, round2(num(input.discount)));
        const discountType = input.discountType === 'amount' ? 'fixed' : 'percent';
        return {
          summary: `Set a ${discountText(discount, discountType)} discount for "${customer?.name ?? String(input.customer ?? '')}"`,
          details: [
            { label: 'Customer', after: customer?.name ?? String(input.customer ?? '') },
            {
              label: 'Discount',
              before: customer ? discountText(num(customer.default_discount_pct), customer.discount_type) : null,
              after: discountText(discount, discountType),
            },
          ],
        };
      },
    },
    create_expense_draft: {
      async execute(ctx, input) {
        const amount = round2(num(input.amount));
        if (!(amount > 0)) throw new Error('The amount must be more than zero.');
        const categories = listCategories(false);
        const wanted = String(input.category ?? '').trim().toLowerCase();
        const category = wanted
          ? categories.find((c) => c.name.trim().toLowerCase() === wanted)
          : categories.find((c) => c.is_active === 1);
        if (!category) throw new Error('No expense category matched that name.');
        const note = String(input.note ?? '').trim();
        const date = dateOnly(input.date) ?? todayIso();
        const created = createExpense({
          category_id: category.id,
          user_id: ctx.user.id,
          title: note || 'Expense',
          description: note || undefined,
          amount,
          expense_date: date,
          is_recurring: false,
        });
        if (!created.ok || !created.id) throw new Error(created.message || 'The expense could not be saved.');
        // A DRAFT: the expense is saved but it does not count towards the
        // totals until the owner activates it (the app's own "paused" status).
        const paused = updateExpense(created.id, { status: 'paused' });
        if (!paused.ok) throw new Error(paused.message || 'The expense draft could not be saved.');
        return {
          ok: true,
          expense_id: created.id,
          title: note || 'Expense',
          amount,
          category: category.name,
          date,
          status: 'paused',
        };
      },
      async preview(_ctx, input) {
        const amount = round2(num(input.amount));
        const categories = listCategories(false);
        const wanted = String(input.category ?? '').trim().toLowerCase();
        const category = wanted
          ? categories.find((c) => c.name.trim().toLowerCase() === wanted)
          : categories.find((c) => c.is_active === 1);
        return {
          summary: `Save an expense draft of ${makeMoney(printCurrency())(amount)} for the owner to review`,
          details: [
            { label: 'Amount', after: makeMoney(printCurrency())(amount) },
            { label: 'Category', after: category?.name ?? String(input.category ?? '—') },
            { label: 'Note', after: String(input.note ?? '—') },
            { label: 'Date', after: dateOnly(input.date) ?? todayIso() },
          ],
        };
      },
    },
    create_promotion_draft: {
      async execute(_ctx, input) {
        const name = String(input.name ?? '').trim();
        if (!name) throw new Error('The promotion needs a name.');
        const product = findProduct({ product: String(input.product ?? '') });
        if (!product) throw new Error('Tell me which product the promotion is for.');
        const percent = round2(num(input.percent));
        if (!(percent > 0)) throw new Error('The discount percent must be more than zero.');
        const startsOn = dateOnly(input.startsOn);
        const endsOn = dateOnly(input.endsOn);
        const promotion = createPromotion({
          name,
          type: 'percent',
          scope: 'product',
          product_id: product.id,
          discount_value: percent,
          buy_qty: 0,
          free_qty: 0,
          start_date: startsOn,
          end_date: endsOn,
          // A DRAFT: the promotion stays inactive until the owner activates it.
          active: false,
        });
        return {
          ok: true,
          promotion_id: promotion.id,
          name: promotion.name,
          product: product.name,
          percent,
          active: false,
        };
      },
      async preview(_ctx, input) {
        const product = findProduct({ product: String(input.product ?? '') });
        const percent = round2(num(input.percent));
        return {
          summary: `Save a promotion draft: ${percent}% off "${product?.name ?? String(input.product ?? '')}"`,
          details: [
            { label: 'Name', after: String(input.name ?? '') },
            { label: 'Product', after: product?.name ?? String(input.product ?? '') },
            { label: 'Discount', after: `${percent}%` },
            { label: 'From', after: dateOnly(input.startsOn) ?? '—' },
            { label: 'To', after: dateOnly(input.endsOn) ?? '—' },
            { label: 'Status', after: 'draft (inactive)' },
          ],
        };
      },
    },
    stock_adjustment: {
      async execute(_ctx, input) {
        const product = findProduct(input);
        if (!product) throw new Error('No product matched that name or barcode.');
        const changeQty = num(input.changeQty);
        if (!changeQty) throw new Error('How much should the stock change by?');
        const reason = String(input.reason ?? '').trim();
        if (!reason) throw new Error('A reason is required for a stock adjustment.');
        const updated = adjustStock(product.id, changeQty, reason);
        return {
          ok: true,
          product_id: product.id,
          name: product.name,
          old_stock: round2(num(product.stock_qty)),
          new_stock: round2(num(updated.stock_qty)),
          change: changeQty,
          reason,
        };
      },
      async preview(_ctx, input) {
        const product = findProduct(input);
        const changeQty = num(input.changeQty);
        const oldStock = product ? round2(num(product.stock_qty)) : 0;
        return {
          summary: `Change the stock of "${product?.name ?? String(input.product ?? '')}" by ${changeQty > 0 ? '+' : ''}${changeQty}`,
          details: [
            { label: 'Product', after: product?.name ?? String(input.product ?? '') },
            { label: 'Stock', before: oldStock, after: round2(oldStock + changeQty) },
            { label: 'Change', after: `${changeQty > 0 ? '+' : ''}${changeQty}` },
            { label: 'Reason', after: String(input.reason ?? '') },
          ],
        };
      },
    },
    update_product_price: {
      async execute(ctx, input) {
        const product = findProduct(input);
        if (!product) throw new Error('No product matched that name or barcode.');
        const salePrice = input.salePrice !== undefined ? round2(num(input.salePrice)) : null;
        const costPrice = input.costPrice !== undefined ? round2(num(input.costPrice)) : null;
        if (salePrice === null && costPrice === null) {
          throw new Error('Give me the new sale price or the new cost price.');
        }
        // The cost price is a manager figure — a role that may not see it may
        // not change it either.
        if (costPrice !== null && !maySeeProfit(ctx)) {
          throw new Error('This role may not change the cost price.');
        }
        const updated = updateProduct(product.id, {
          ...productProfileInput(product),
          sale_price: salePrice ?? num(product.sale_price),
          cost_price: costPrice ?? num(product.cost_price),
        });
        const result: Record<string, unknown> = {
          ok: true,
          product_id: product.id,
          name: product.name,
          old_sale_price: round2(num(product.sale_price)),
          new_sale_price: round2(num(updated.sale_price)),
        };
        if (maySeeProfit(ctx)) {
          result.old_cost_price = round2(num(product.cost_price));
          result.new_cost_price = round2(num(updated.cost_price));
        }
        return result;
      },
      async preview(ctx, input) {
        const product = findProduct(input);
        const money = makeMoney(printCurrency());
        const salePrice = input.salePrice !== undefined ? round2(num(input.salePrice)) : null;
        const costPrice = input.costPrice !== undefined ? round2(num(input.costPrice)) : null;
        const details: { label: string; before?: string | number | null; after?: string | number | null }[] = [
          { label: 'Product', after: product?.name ?? String(input.product ?? '') },
        ];
        if (salePrice !== null) {
          details.push({
            label: 'Sale price',
            before: product ? money(num(product.sale_price)) : null,
            after: money(salePrice),
          });
        }
        if (costPrice !== null && maySeeProfit(ctx)) {
          details.push({
            label: 'Cost price',
            before: product ? money(num(product.cost_price)) : null,
            after: money(costPrice),
          });
        }
        return {
          summary: `Change the price of "${product?.name ?? String(input.product ?? '')}"`,
          details,
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
