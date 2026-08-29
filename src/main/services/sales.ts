import { getDb } from '../db';
import { getProduct, recordMovement, getProductBatches, deductStockFIFO, roundStock } from './inventory';
import { getSetting } from './settings';
import { logActivity } from './activity';
import { getSessionUserId } from './auth';
import * as licensing from './licensing';
import { currentShift } from './shifts';
import { resolvePromotions } from './promotions';
import type {
  BillLineInput,
  Customer,
  HeldBill,
  Payment,
  PaymentInput,
  Sale,
  SaleCreateResult,
  SaleInput,
  SaleItem,
} from '../../shared/types';

interface ComputedLine {
  product_id: number;
  qty: number;
  price: number;
  line_discount: number;
  tax_rate: number;
  line_taxable: number;
  line_tax: number;
  line_total: number;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

export function nextInvoiceNo(): string {
  const db = getDb();
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const prefix = `INV-${ymd}-`;
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM sales WHERE invoice_no LIKE ?")
    .get(prefix + '%') as { c: number };
  return prefix + pad(row.c + 1, 4);
}

export function computeLines(items: BillLineInput[]): ComputedLine[] {
  return items.map((it) => {
    const line_taxable = Math.max(0, it.price * it.qty - it.line_discount);
    const line_tax = (line_taxable * it.tax_rate) / 100;
    const line_total = line_taxable + line_tax;
    return { ...it, line_taxable, line_tax, line_total };
  });
}

export function computeTotals(
  items: BillLineInput[],
  billDiscount = 0,
  discountType: 'amount' | 'percent' = 'amount'
): { lines: ComputedLine[]; subtotal: number; tax_amount: number; discount_amount: number; total: number } {
  const lines = computeLines(items);
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const billDiscountAmount =
    discountType === 'percent' ? (subtotal * billDiscount) / 100 : Math.min(billDiscount, subtotal);
  const taxAmount = lines.reduce((s, l) => s + l.line_tax, 0);
  const lineDiscounts = lines.reduce((s, l) => s + l.line_discount, 0);
  const total = Math.max(0, subtotal - billDiscountAmount);
  return {
    lines,
    subtotal,
    tax_amount: taxAmount,
    discount_amount: lineDiscounts + billDiscountAmount,
    total,
  };
}

export function createSale(input: SaleInput): SaleCreateResult {
  // Ensure license is still valid (offline check). Throws if beyond grace period.
  licensing.ensureLicenseValidSync();
  const db = getDb();
  const resolved = resolvePromotions(
    input.items.map((it) => ({ product_id: it.product_id, qty: it.qty, price: it.price }))
  );
  const promoOf = new Map(resolved.filter((r) => r.promo_id !== null).map((r) => [r.product_id, r]));
  const effectiveItems = input.items.map((it) => {
    const promo = promoOf.get(it.product_id);
    return promo ? { ...it, price: promo.effective_price } : it;
  });
  const { lines, tax_amount, discount_amount, total } = computeTotals(
    effectiveItems,
    input.bill_discount ?? 0,
    input.discount_type ?? 'amount'
  );

  // Service charge handling (amount or percent)
  const serviceCharge = input.service_charge ?? 0;
  const serviceChargeType = input.service_charge_type ?? 'amount';
  const serviceChargeAmt = serviceChargeType === 'percent' ? (total * serviceCharge) / 100 : serviceCharge;
  const freight = input.freight ?? 0;
  const finalTotal = total + serviceChargeAmt + freight;

  // Price floor protection (prevent selling below cost unless overridden)
  const priceFloorEnabled = getSetting('price_floor_enabled') !== '0';
  if (priceFloorEnabled && !input.price_floor_override) {
    const belowCostItems = lines.filter((l) => {
      const p = getProduct(l.product_id);
      if (!p) return false;
      const cost = p.cost_price ?? 0;
      return l.price < cost;
    });
    if (belowCostItems.length > 0) {
      const names = belowCostItems
        .map((l) => {
          const prod = getProduct(l.product_id);
          return prod?.name ?? `#${l.product_id}`;
        })
        .join(', ');
      throw new Error(`Below cost items: ${names}`);
    }
  }

  // Determine if any price was overridden (compared to standard retail/wholesale)
  const priceOverridden = input.items.some((it) => {
    const product = getProduct(it.product_id);
    if (!product) return false;
    const expected = input.price_mode === 'wholesale' && product.wholesale_price != null ? product.wholesale_price : product.sale_price;
    return it.price !== expected;
  });

  if (lines.length === 0) throw new Error('Bill has no items');

  // Pre-validate stock (no mutation) before opening the transaction
  for (const l of lines) {
    const p = getProduct(l.product_id);
    if (!p) throw new Error(`Product ${l.product_id} not found`);
    if (p.stock_qty < roundStock(l.qty)) throw new Error(`Insufficient stock: ${p.name} (${p.stock_qty} available)`);
  }

  const payments = input.payments.filter((p) => p.amount > 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const balance = Math.max(0, finalTotal - paid);
  const change = Math.max(0, paid - finalTotal);
  if (balance > 0 && !input.customer_id) {
    throw new Error('Unpaid balance requires a customer (Udhaar)');
  }

  const openShift = currentShift();
  if (!openShift) {
    throw new Error('No open shift — please open a shift before billing');
  }

  db.exec('BEGIN');
  try {
    // FIFO batch deduction (mutates batches + product stock, rolled back on error)
    const batchAllocations: Map<number, { batchId: number; qty: number }[]> = new Map();
    for (const l of lines) {
      const allocation = deductStockFIFO(l.product_id, roundStock(l.qty));
      batchAllocations.set(l.product_id, allocation);
    }
    const invoiceNo = nextInvoiceNo();
    const nowIso = new Date().toISOString();
    const saleInfo = db
      .prepare(
        `INSERT INTO sales (invoice_no, customer_id, user_id, shift_id, subtotal, tax_amount, discount_amount, total_amount, service_charge, service_charge_type, freight, price_overridden, status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
      )
      .run(
        invoiceNo,
        input.customer_id ?? null,
        getSessionUserId() ?? 1,
        openShift.id,
        lines.reduce((s, l) => s + l.line_taxable, 0),
        tax_amount,
        discount_amount,
        finalTotal,
        serviceChargeAmt,
        serviceChargeType,
        freight,
        priceOverridden ? 1 : 0,
        input.notes ?? null,
        nowIso
      );
    const saleId = Number(saleInfo.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, tax_rate, line_total, promo_id, promo_name, batch_id, box_qty, unit_name, display_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const l of lines) {
      const promo = promoOf.get(l.product_id);
      const allocation = batchAllocations.get(l.product_id) || [];
      const boxQty = (l as any).box_qty ?? null;
      const unitName = (l as any).unit_name ?? null;
      const displayQty = (l as any).display_qty ?? null;
      
      if (allocation.length === 1) {
        // Single batch - simple case
        insItem.run(
          saleId,
          l.product_id,
          l.qty,
          l.price,
          l.line_discount,
          l.tax_rate,
          l.line_total,
          promo?.promo_id ?? null,
          promo?.promo_name ?? null,
          allocation[0].batchId,
          boxQty,
          unitName,
          displayQty
        );
        recordMovement(l.product_id, -l.qty, 'Sale', 'sale', saleId, allocation[0].batchId);
      } else {
        // Multiple batches - need to split sale_items rows per batch
        for (const alloc of allocation) {
          const allocQty = alloc.qty;
          const allocLineTotal = (l.price * allocQty) + ((l.price * allocQty - l.line_discount * (allocQty / l.qty)) * l.tax_rate / 100);
          insItem.run(
            saleId,
            l.product_id,
            allocQty,
            l.price,
            l.line_discount * (allocQty / l.qty),
            l.tax_rate,
            allocLineTotal,
            promo?.promo_id ?? null,
            promo?.promo_name ?? null,
            alloc.batchId,
            boxQty,
            unitName,
            displayQty != null ? (allocQty / l.qty) * displayQty : null
          );
          recordMovement(l.product_id, -allocQty, 'Sale', 'sale', saleId, alloc.batchId);
        }
      }
    }

    const insPay = db.prepare(
      `INSERT INTO payments (sale_id, mode, amount, reference, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    const payRows: Payment[] = [];
    for (const p of payments) {
      insPay.run(saleId, p.mode, p.amount, p.reference ?? null, nowIso);
      payRows.push({ id: 0, sale_id: saleId, mode: p.mode, amount: p.amount, reference: p.reference ?? null, created_at: nowIso });
    }

    if (balance > 0 && input.customer_id) {
      const cust = db.prepare('SELECT id, balance, credit_limit FROM customers WHERE id = ?').get(
        input.customer_id
      ) as { id: number; balance: number; credit_limit: number | null } | undefined;
      if (!cust) throw new Error('Customer not found');
      const limit = cust.credit_limit ?? 0;
      if (limit > 0 && cust.balance + balance > limit) {
        throw new Error(
          `Credit limit exceeded — balance would reach ${(cust.balance + balance).toFixed(2)} (limit ${limit.toFixed(2)})`
        );
      }
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(balance, input.customer_id);
      db.prepare(
        'INSERT INTO customer_transactions (customer_id, sale_id, amount, type) VALUES (?, ?, ?, ?)'
      ).run(input.customer_id, saleId, balance, 'sale');
    }

    db.exec('COMMIT');

    const sale = getSale(saleId);
    if (!sale) throw new Error('Failed to load created sale');
      logActivity(
        'sale_created',
        'sale',
        saleId,
        `${invoiceNo} | total=${finalTotal} | discount=${discount_amount} | paid=${paid} | balance=${balance} | promos=${promoOf.size}`
      );
    return { sale, items: sale.items, payments: payRows, change, balance };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSale(id: number): (Sale & { items: SaleItem[]; payments: Payment[] }) | null {
  const db = getDb();
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`
    )
    .get(id) as unknown as Sale | undefined;
  if (!sale) return null;
  const items = db
    .prepare(
      `SELECT i.*, p.name AS product_name
       FROM sale_items i LEFT JOIN products p ON p.id = i.product_id
       WHERE i.sale_id = ?`
    )
    .all(id) as unknown as SaleItem[];
  const payments = db
    .prepare('SELECT * FROM payments WHERE sale_id = ?')
    .all(id) as unknown as Payment[];
  return { ...sale, items, payments };
}

export function listSales(
  from?: string,
  to?: string,
  includeVoided = false,
  customerId?: number,
  userId?: number,
  paymentMode?: string,
  productId?: number,
  minAmount?: number,
  maxAmount?: number,
  saleNo?: string,
  sortBy?: 'date' | 'amount' | 'saleNo',
  sortOrder?: 'asc' | 'desc',
  onlyMySales?: boolean,
  status?: 'completed' | 'voided' | 'held'
): Sale[] {
  const db = getDb();
  let sql = `
    SELECT s.*, c.name AS customer_name, u.username AS cashier_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  
  if (status === 'held') {
    sql = `
      SELECT hb.*, c.name AS customer_name, u.username AS cashier_name
      FROM held_bills hb
      LEFT JOIN customers c ON c.id = hb.customer_id
      LEFT JOIN users u ON u.id = hb.user_id
      WHERE 1=1
    `;
  } else {
    if (!includeVoided && status !== 'voided') {
      sql += " AND s.status != 'voided'";
    }
    if (status === 'voided') {
      sql += " AND s.status = 'voided'";
    }
  }
  
  if (from) {
    sql += ' AND date(s.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(s.created_at) <= date(?)';
    params.push(to);
  }
  if (customerId) {
    sql += ' AND s.customer_id = ?';
    params.push(customerId);
  }
  if (userId) {
    sql += ' AND s.user_id = ?';
    params.push(userId);
  }
  if (paymentMode) {
    sql += ` AND EXISTS (
      SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.mode = ?
    )`;
    params.push(paymentMode);
  }
  if (productId) {
    sql += ` AND EXISTS (
      SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = ?
    )`;
    params.push(productId);
  }
  if (minAmount !== undefined) {
    sql += ' AND s.total_amount >= ?';
    params.push(minAmount);
  }
  if (maxAmount !== undefined) {
    sql += ' AND s.total_amount <= ?';
    params.push(maxAmount);
  }
  if (saleNo) {
    sql += ' AND s.invoice_no LIKE ?';
    params.push(`%${saleNo}%`);
  }
  if (onlyMySales) {
    const currentUserId = getSessionUserId();
    if (currentUserId) {
      sql += ' AND s.user_id = ?';
      params.push(currentUserId);
    }
  }
  
  const orderBy = sortBy === 'amount' ? 's.total_amount' : sortBy === 'saleNo' ? 's.invoice_no' : 's.created_at';
  sql += ` ORDER BY ${orderBy} ${sortOrder?.toUpperCase() || 'DESC'}, s.id DESC LIMIT 500`;
  
  return db.prepare(sql).all(...params) as unknown as Sale[];
}

export function voidSale(id: number, reason: string): boolean {
  const db = getDb();
  const sale = getSale(id);
  if (!sale) throw new Error('Sale not found');
  if (sale.status !== 'completed') throw new Error('Only completed sales can be voided');

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE sales SET status = 'voided', notes = ? WHERE id = ?").run(
      (sale.notes ? sale.notes + ' | ' : '') + 'VOID: ' + reason,
      id
    );
    for (const it of sale.items) {
      const batchId = (it as any).batch_id;
      if (batchId) {
        // Restore to specific batch
        db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?')
          .run(roundStock(it.qty), batchId);
        db.prepare('UPDATE products SET stock_qty = stock_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(roundStock(it.qty), it.product_id);
        db.prepare(
          `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(it.product_id, roundStock(it.qty), 'Voided sale', 'sale', id, batchId);
      } else {
        // Legacy: no batch tracking
        recordMovement(it.product_id, it.qty, 'Voided sale', 'sale', id);
      }
    }
    if (sale.customer_id) {
      const paid = sale.payments.reduce((s, p) => s + p.amount, 0);
      const saleBalance = Math.max(0, sale.total_amount - paid);
      const current = db.prepare('SELECT balance FROM customers WHERE id = ?').get(sale.customer_id) as { balance: number };
      const reverse = Math.min(saleBalance, Math.max(0, current.balance));
      if (reverse > 0) {
        db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(reverse, sale.customer_id);
        db.prepare(
          'INSERT INTO customer_transactions (customer_id, sale_id, amount, type) VALUES (?, ?, ?, ?)'
        ).run(sale.customer_id, id, -reverse, 'void');
      }
    }
    db.exec('COMMIT');
    logActivity('sale_voided', 'sale', id, `invoice=${sale.invoice_no} | reason=${reason}`);
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function holdBill(kind: 'held' | 'quotation', label: string, data: unknown): HeldBill {
  const db = getDb();
  const info = db
    .prepare('INSERT INTO held_bills (kind, label, data) VALUES (?, ?, ?)')
    .run(kind, label, JSON.stringify(data));
  return { id: Number(info.lastInsertRowid), kind, label, data: JSON.stringify(data) };
}

export function listHeldBills(kind?: 'held' | 'quotation'): HeldBill[] {
  const db = getDb();
  const params: string[] = [];
  let sql = 'SELECT * FROM held_bills';
  if (kind) {
    sql += ' WHERE kind = ?';
    params.push(kind);
  }
  sql += ' ORDER BY id DESC LIMIT 100';
  return db.prepare(sql).all(...params) as unknown as HeldBill[];
}

export function getHeldBill(id: number): HeldBill | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM held_bills WHERE id = ?').get(id) as unknown as HeldBill | undefined) ?? null;
}

export function deleteHeldBill(id: number): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM held_bills WHERE id = ?').run(id).changes > 0;
}

export function listCustomers(status?: 'paid' | 'pending' | 'all', from?: string, to?: string): Customer[] {
  const db = getDb();
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params: (string | number)[] = [];
  
  if (status === 'paid') {
    sql += ' AND balance <= 0';
  } else if (status === 'pending') {
    sql += ' AND balance > 0';
  }
  
  if (from) {
    sql += ' AND date(created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(created_at) <= date(?)';
    params.push(to);
  }
  
  sql += ' ORDER BY name COLLATE NOCASE';
  return db.prepare(sql).all(...params) as unknown as Customer[];
}

export function createCustomer(name: string, phone?: string, openingBalance = 0): Customer {
  const db = getDb();
  if (typeof openingBalance !== 'number' || !Number.isFinite(openingBalance) || openingBalance < 0) {
    throw new Error('Opening balance must be a valid non-negative amount');
  }
  db.exec('BEGIN');
  try {
    const info = db
      .prepare('INSERT INTO customers (name, phone, balance) VALUES (?, ?, ?)')
      .run(name.trim(), phone?.trim() || null, openingBalance);
    const id = Number(info.lastInsertRowid);
    if (openingBalance > 0) {
      db.prepare(
        'INSERT INTO customer_transactions (customer_id, amount, type, sale_id) VALUES (?, ?, ?, NULL)'
      ).run(id, openingBalance, 'opening_balance');
    }
    db.exec('COMMIT');
    logActivity('customer_created', 'customer', id, `opening_balance=${openingBalance}`);
    return {
      id,
      name: name.trim(),
      phone: phone?.trim() || null,
      address: null,
      balance: openingBalance,
    };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function setCreditLimit(customerId: number, limit: number): Customer {
  const db = getDb();
  if (limit < 0) throw new Error('Limit cannot be negative');
  db.prepare('UPDATE customers SET credit_limit = ? WHERE id = ?').run(limit, customerId);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as unknown as Customer;
}

export interface CustomerTransaction {
  id: number;
  customer_id: number;
  sale_id: number | null;
  payment_id: number | null;
  amount: number;
  type: string;
  created_at?: string;
  running: number;
}

export function customerLedger(customerId: number): CustomerTransaction[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, customer_id, sale_id, payment_id, amount, type, created_at,
              SUM(amount) OVER (ORDER BY id) AS running
       FROM customer_transactions
       WHERE customer_id = ?
       ORDER BY id`
    )
    .all(customerId) as unknown as CustomerTransaction[];
}

export function receivePayment(customerId: number, amount: number, mode: string, note?: string): Customer {
  const db = getDb();
  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as
    | (Customer & { id: number })
    | undefined;
  if (!cust) throw new Error('Customer not found');
  if (amount <= 0) throw new Error('Payment amount must be positive');
  if (amount > cust.balance) throw new Error(`Amount exceeds outstanding balance (${cust.balance})`);

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO customer_transactions (customer_id, amount, type, sale_id) VALUES (?, ?, ?, NULL)'
    ).run(customerId, -amount, `payment:${mode}` + (note ? `:${note}` : ''));
    db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(amount, customerId);
    db.exec('COMMIT');
    logActivity('payment_received', 'customer', customerId, `amount=${amount} | mode=${mode}${note ? ' | note=' + note : ''}`);
    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as unknown as Customer;
    return updated;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}