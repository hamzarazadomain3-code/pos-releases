/**
 * Phase 3 — Purchase import (Excel / CSV).
 *
 * One service for:
 *   - parsing a picked .xlsx/.xls/.csv file into raw rows (auto header detect),
 *   - writing the downloadable sample template,
 *   - confirming the wizard: creates the purchase document (PO = no stock
 *     change, Purchase Invoice = stock now), applies optional product price
 *     updates, updates the supplier ledger and writes the audit log,
 *   - undoing the LAST import (reverses stock + ledger) within the session.
 *
 * Safety rules followed here:
 *   - every number passes through `safeNumber` (never NaN in the DB),
 *   - the whole confirm runs in one transaction,
 *   - the undo payload is stored so a reversal is exact,
 *   - cashiers cannot import (manager/owner only — the permission matrix adds
 *     `can_import_purchase`; rank enforcement matches the rest of the app).
 */
import { dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { getDb } from '../db';
import { getProduct, createProduct, roundStock, recordMovement, addToBatch } from './inventory';
import { getPurchaseOrder, insertPurchaseOrderCore, RECEIVED_QTY_SQL, type PurchaseLineInput } from './purchases';
import { logActivity } from './activity';
import { can, getSessionUserId } from './auth';
import { getPrintSettings, toShopProfile } from './printDocs';
import { printDocument, previewDocument } from './printService';
import { saveXlsx } from './export';
import { normalizeBinaryPayload } from '../../shared/binaryTransfer';
import type { PrintPreviewLabels } from '../../shared/types';
import { lineMoney, round2, unitsInBase, baseQty, costPerBaseUnit } from '../../shared/purchaseCalc';
import {
  defaultDocumentDesign,
  renderDocument,
  type DocumentDesign,
  type DocumentPaper,
  type SaleData,
} from '../../shared/receiptDesign';
import type {
  PurchaseImportLogRow,
  PurchaseImportParseResult,
  PurchaseImportPayload,
  PurchaseImportRow,
  PurchaseImportSummary,
} from '../../shared/types';

const MAX_PREVIEW_ROWS = 5000;

/** Never NaN: parse a cell that may be '1,200.50', ' 12 ', '', null… */
export function safeNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v === null || v === undefined) return fallback;
  const cleaned = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-+eE]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Phase 3, item 5 — the import is a MANAGER action and the check lives in the
 * SERVICE. The message names the permission id the app already uses
 * (`can_import_purchase`) so the owner knows what to ask for.
 */
function requireImportPermission(): void {
  if (!can('manager')) {
    throw new Error('Importing purchases needs a manager/owner (can_import_purchase).');
  }
}

/**
 * Parse an import file. Header row = the first row that has at least two
 * non-empty cells (skips title/blank rows vendors put above the real header).
 */
export function parsePurchaseFile(filePath: string): PurchaseImportParseResult {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  return parsePurchaseWorkbook(wb, filePath.split(/[\\/]/).pop() || filePath);
}

/**
 * Parse an import file whose CONTENT is already in memory.
 *
 * The web app has no file system: the renderer picks the file with an
 * `<input type="file">` and sends the bytes (base64, because the web transport
 * is JSON). This is the same parse as `parsePurchaseFile` — .xlsx, .xls and
 * .csv all work, because SheetJS detects the format from the content.
 */
export function parsePurchaseData(fileName: string, payload: unknown): PurchaseImportParseResult {
  const bytes = normalizeBinaryPayload(payload);
  if (!bytes) throw new Error('The file could not be read.');
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  return parsePurchaseWorkbook(wb, fileName);
}

/** The shared grid → rows rule (header detect, value map, preview cap). */
function parsePurchaseWorkbook(wb: XLSX.WorkBook, fileName: string): PurchaseImportParseResult {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('The file has no sheets');
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  if (!grid.length) throw new Error('The file has no rows');

  let headerIndex = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const nonEmpty = (grid[i] || []).filter((c) => String(c ?? '').trim() !== '').length;
    if (nonEmpty >= 2) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) throw new Error('Could not find a header row');

  const headers = (grid[headerIndex] || []).map((h) => String(h ?? '').trim());
  const rawRows = grid
    .slice(headerIndex + 1)
    .filter((r) => (r || []).some((c) => String(c ?? '').trim() !== ''))
    .slice(0, MAX_PREVIEW_ROWS);

  const rows: PurchaseImportRow[] = rawRows.map((cells, idx) => {
    const values: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `#${c + 1}`;
      if (!(key in values)) values[key] = String((cells || [])[c] ?? '').trim();
    }
    return { row: headerIndex + idx + 2, values }; // 1-based file line numbers
  });

  return { file_name: fileName, sheet: sheetName, header_row: headerIndex + 1, headers, rows };
}

/** File picker for the wizard (.xlsx/.xls/.csv). Returns null when cancelled. */
export async function pickPurchaseImportFile(win: BrowserWindow | null): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Choose a purchase file (.xlsx, .xls or .csv)',
    properties: ['openFile'],
    filters: [
      { name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.length) return null;
  return filePaths[0];
}

/** Downloadable sample template (xlsx) with the import's canonical columns. */
export async function savePurchaseImportTemplate(win: BrowserWindow | null): Promise<boolean | string> {
  const headers = [
    'barcode', 'sku', 'product name', 'qty', 'unit', 'cost rate',
    'sale price', 'wholesale price', 'discount %', 'tax %', 'batch', 'expiry date', 'notes',
  ];
  const sample = [
    ['8901234567890', 'SKU-001', 'Basmati Rice 5kg', 10, 'Bag', 1850, 2100, 2050, 0, 0, 'B-2401', '2026-12-31', 'sample row — replace with your data'],
    ['', 'SKU-002', 'Cooking Oil 5L', 6, 'Piece', 3800, 4200, 4100, 2, 0, '', '2027-06-30', ''],
  ];
  // The desktop writes the file through the native save dialog; the web build
  // has no dialog, so the workbook comes back as bytes for the browser to
  // download.
  return saveXlsx(win, 'purchase-import-template.xlsx', [{ name: 'Purchase Import', headers, rows: sample }]);
}

/**
 * Confirm a wizard import. Everything (PO rows, stock for invoices, price
 * updates, ledger, audit log, undo payload) happens in one place.
 */
export function importPurchaseOrders(payload: PurchaseImportPayload): PurchaseImportSummary {
  requireImportPermission();
  const db = getDb();
  if (!payload?.supplier_id) throw new Error('Choose a supplier first');
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) throw new Error('Nothing to import');

  const opt = {
    updateCostPrice: payload.options?.updateCostPrice !== false,
    updateSalePrice: payload.options?.updateSalePrice === true,
    updateOnlyIfChanged: payload.options?.updateOnlyIfChanged === true,
    mergeDuplicates: payload.options?.mergeDuplicates !== false,
  };

  const errors: { row: number; message: string }[] = [];
  const createdProducts: number[] = [];

  // ── 1. materialise rows: create new products, resolve ids, merge dupes ──
  type Ready = { row: number; product_id: number; qty: number; unit_cost: number; sale?: number | null; whole?: number | null; disc: number; tax: number; batch?: string | null; expiry?: string | null; notes?: string | null; units_in_base?: number | null; unit_name?: string | null };
  const ready: Ready[] = [];

  for (const r of payload.rows) {
    try {
      const qty = safeNumber(r.qty, NaN as unknown as number);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push({ row: r.row, message: `Invalid quantity "${r.qty ?? ''}"` });
        continue;
      }
      let productId = r.product_id ?? null;
      if (!productId && r.create_new) {
        const name = String(r.create_new.name || '').trim();
        if (!name) {
          errors.push({ row: r.row, message: 'New product needs a name' });
          continue;
        }
        const p = createProduct({
          name,
          barcode: r.create_new.barcode?.trim() || undefined,
          sku: r.create_new.sku?.trim() || undefined,
          sale_price: safeNumber(r.sale_price, 0),
          cost_price: safeNumber(r.unit_cost, 0),
          stock_qty: 0,
        });
        productId = p.id;
        createdProducts.push(p.id);
      }
      if (!productId || !getProduct(productId)) {
        errors.push({ row: r.row, message: 'No matching product' });
        continue;
      }
      ready.push({
        row: r.row,
        product_id: productId,
        qty,
        unit_cost: safeNumber(r.unit_cost, 0),
        sale: r.sale_price != null && String(r.sale_price) !== '' ? safeNumber(r.sale_price, 0) : null,
        whole: r.wholesale_price != null && String(r.wholesale_price) !== '' ? safeNumber(r.wholesale_price, 0) : null,
        disc: safeNumber(r.discount_pct, 0),
        tax: safeNumber(r.tax_pct, 0),
        batch: r.batch_no ?? null,
        expiry: r.expiry_date ?? null,
        notes: r.notes ?? null,
        // Phase 1, item 1.12 — the purchase unit of this line. The wizard
        // resolves the file's `unit` column against the product's own units.
        units_in_base: r.units_in_base ?? null,
        unit_name: r.unit_name ?? null,
      });
    } catch (e) {
      errors.push({ row: r.row, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Merge duplicate product rows (sum qty, last cost wins for the line).
  let merged: Ready[] = ready;
  if (opt.mergeDuplicates) {
    const byProduct = new Map<number, Ready>();
    for (const r of ready) {
      const existing = byProduct.get(r.product_id);
      if (!existing) byProduct.set(r.product_id, { ...r });
      else {
        existing.qty = roundStock(existing.qty + r.qty);
        existing.unit_cost = r.unit_cost || existing.unit_cost;
        existing.sale = r.sale ?? existing.sale;
        existing.whole = r.whole ?? existing.whole;
      }
    }
    merged = [...byProduct.values()];
  }
  if (!merged.length) {
    return {
      import_id: null,
      purchase_order_id: null,
      imported: 0,
      created: createdProducts.length,
      skipped: payload.rows.length,
      failed: errors.length,
      errors,
      created_product_ids: createdProducts,
    };
  }

  const docType = payload.document_type === 'purchase_invoice' ? 'purchase_invoice' : 'purchase_order';
  const userId = getSessionUserId() ?? 1;

  db.exec('BEGIN');
  let importId: number | null = null;
  let poId: number | null = null;
  try {
    // ── 2. import log row (undo payload written after ids exist) ──
    const impInfo = db
      .prepare(
        `INSERT INTO purchase_imports (supplier_id, document_type, reference_no, file_name, row_count, created_at, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.supplier_id,
        docType,
        payload.reference_no ?? null,
        payload.file_name ?? null,
        payload.rows.length,
        new Date().toISOString(),
        userId
      );
    importId = Number(impInfo.lastInsertRowid);

    // ── 3. the purchase document itself ──
    const items: PurchaseLineInput[] = merged.map((r) => ({
      product_id: r.product_id,
      qty: r.qty,
      unit_cost: r.unit_cost,
      batch_no: r.batch ?? null,
      expiry_date: r.expiry ?? null,
      discount_pct: r.disc,
      tax_pct: r.tax,
      sale_price: r.sale,
      wholesale_price: r.whole,
      units_in_base: r.units_in_base ?? null,
      unit_name: r.unit_name ?? null,
    }));
    const po = insertPurchaseOrderCore(payload.supplier_id, items, {
      document_type: docType,
      reference_no: payload.reference_no ?? null,
      invoice_date: payload.invoice_date ?? null,
      import_id: importId,
    });
    poId = po.id;

    // ── 4. product price updates (per the wizard's options) ──
    for (const r of merged) {
      const p = getProduct(r.product_id);
      if (!p) continue;
      const sets: string[] = [];
      const vals: number[] = [];
      if (opt.updateCostPrice) {
        if (!opt.updateOnlyIfChanged || Math.abs(Number(p.cost_price) - r.unit_cost) > 1e-9) {
          sets.push('cost_price = ?');
          vals.push(r.unit_cost);
          db.prepare('INSERT INTO purchase_price_history (product_id, unit_cost, purchase_order_id) VALUES (?, ?, ?)').run(
            r.product_id,
            r.unit_cost,
            poId
          );
        }
      }
      if (opt.updateSalePrice && r.sale != null) {
        if (!opt.updateOnlyIfChanged || Math.abs(Number(p.sale_price) - r.sale) > 1e-9) {
          sets.push('sale_price = ?');
          vals.push(r.sale);
        }
      }
      if (opt.updateSalePrice && r.whole != null) {
        if (!opt.updateOnlyIfChanged || Math.abs(Number(p.wholesale_price ?? 0) - r.whole) > 1e-9) {
          sets.push('wholesale_price = ?');
          vals.push(r.whole);
        }
      }
      if (sets.length) {
        vals.push(r.product_id);
        db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);
      }
    }

    // ── 5. stock now when it is a PURCHASE INVOICE (PO waits for receive) ──
    if (docType === 'purchase_invoice') {
      for (const r of merged) {
        const batchNumber = r.batch || `IMP-${importId}-${r.product_id}-${Date.now()}`;
        // Phase 1, item 1.12 — the stock comes on in BASE units. A file that
        // says "2 box" of a 12-piece box puts 24 pieces on the shelf, not 2.
        // The cost per base unit follows the same rule.
        const multiplier = unitsInBase(r.units_in_base);
        const baseReceived = baseQty(r.qty, multiplier);
        const costPerBase = costPerBaseUnit(r.unit_cost, multiplier);
        // Phase 1, item 1.11 — `createBatch` writes `quantity_received` (the
        // raw INSERT left it at 0, so the FIFO report showed these batches as
        // empty), and the batch number is now STORED on the purchase line so
        // the undo below can delete exactly this batch.
        //
        // Phase 3, item 12 — a batch number IS the batch: the same number
        // adds to the existing row instead of creating a second one.
        addToBatch(r.product_id, batchNumber, baseReceived, costPerBase, r.expiry ?? null);
        db.prepare('UPDATE purchase_items SET batch_no = ?, batch_number = ? WHERE purchase_order_id = ? AND product_id = ?').run(
          batchNumber,
          batchNumber,
          poId,
          r.product_id
        );
        recordMovement(r.product_id, baseReceived, 'Purchase import (invoice)', 'purchase', poId);
      }
      db
        .prepare('UPDATE purchase_items SET received_qty = qty, quantity_received = qty WHERE purchase_order_id = ?')
        .run(poId);
      db.prepare("UPDATE purchase_orders SET status = 'received' WHERE id = ?").run(poId);
    }

    // ── 6. summary + undo payload ──
    const summary = {
      import_id: importId,
      purchase_order_id: poId,
      imported: merged.length,
      created: createdProducts.length,
      skipped: payload.rows.length - merged.length - errors.length,
      failed: errors.length,
      errors,
      created_product_ids: createdProducts,
    };
    db
      .prepare(
        `UPDATE purchase_imports SET imported_count = ?, created_count = ?, skipped_count = ?, failed_count = ?, payload_json = ?
         WHERE id = ?`
      )
      .run(
        summary.imported,
        summary.created,
        summary.skipped,
        summary.failed,
        JSON.stringify({ summary, document_type: docType, supplier_id: payload.supplier_id }),
        importId
      );

    db.exec('COMMIT');
    logActivity(
      'purchase_imported',
      'purchase_order',
      poId,
      `import=${importId} | supplier=${payload.supplier_id} | rows=${payload.rows.length} | imported=${summary.imported} | created=${summary.created} | failed=${summary.failed}`
    );
    return summary;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Undo the LAST import: deletes its purchase document, reverses the supplier
 * ledger transaction, and (for a purchase invoice) removes the stock it added
 * — including any that pushed the product negative afterwards, which is why
 * the reversal is a plain negative movement (safe in both directions).
 */
export function undoPurchaseImport(importId?: number): { ok: boolean; message: string } {
  requireImportPermission();
  const db = getDb();

  const imp = importId
    ? (db.prepare('SELECT * FROM purchase_imports WHERE id = ?').get(importId) as any)
    : (db.prepare('SELECT * FROM purchase_imports ORDER BY id DESC LIMIT 1').get() as any);
  if (!imp) throw new Error('No import to undo');

  const po = db
    .prepare('SELECT * FROM purchase_orders WHERE import_id = ?')
    .get(imp.id) as { id: number; supplier_id: number; total_amount: number; status: string; document_type: string } | undefined;
  if (!po) throw new Error('This import has no purchase document (already undone?)');

  db.exec('BEGIN');
  try {
    // Reverse stock only for a purchase invoice (a PO never moved stock).
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_order_id = ?').all(po.id) as any[];
    if (po.document_type === 'purchase_invoice') {
      for (const it of items) {
        if (!(Number(it.received_qty) > 0)) continue;
        // Remove the batch quantity we added, then move product stock back.
        // Phase 1, item 1.11 — the batch number is now always on the line
        // (the import used to generate an `IMP-...` name and never store it,
        // so this DELETE matched nothing and the batch survived the undo).
        const batchNumber = it.batch_no || it.batch_number || '';
        if (batchNumber) {
          db.prepare('DELETE FROM product_batches WHERE product_id = ? AND batch_number = ?').run(
            it.product_id,
            batchNumber
          );
        }
        // The stock went on in BASE units ("2 boxes of 12" = 24 pieces), so it
        // has to come off in BASE units too. Reversing the purchase quantity
        // would leave 22 of the 24 pieces on the shelf.
        const receivedBase = baseQty(Number(it.received_qty), it.unit_multiplier);
        recordMovement(it.product_id, -receivedBase, 'Import undone', 'purchase_undo', po.id);
      }
    } else {
      // Phase 3, item 4 — a PO that was RECEIVED cannot be undone.
      //
      // The old code reversed the stock only for a purchase invoice, but it
      // deleted the purchase document for BOTH kinds. Undoing a received PO
      // therefore removed the order and its ledger row while the stock and
      // the batches stayed on the shelf: the goods were in the shop with no
      // order behind them, and the supplier's balance no longer matched.
      // The undo is refused until the receipt itself is reversed.
      const received = db
        .prepare(
          `SELECT COALESCE(SUM(${RECEIVED_QTY_SQL}), 0) AS received FROM purchase_items WHERE purchase_order_id = ?`
        )
        .get(po.id) as { received?: number } | undefined;
      const receivedQty = Number(received?.received) || 0;
      if (receivedQty > 0) {
        throw new Error(
          `This import's order already received ${receivedQty} — reverse the receipt first, then undo the import.`
        );
      }
    }
    // Reverse the ledger EXACTLY. The original ledger row references the PO via
    // a FK, so it is removed and replaced by a compensating row with no PO link
    // (otherwise deleting the document below would fail on the constraint).
    db.prepare('DELETE FROM supplier_transactions WHERE purchase_order_id = ?').run(po.id);
    db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(po.total_amount, po.supplier_id);
    db.prepare(
      "INSERT INTO supplier_transactions (supplier_id, purchase_order_id, amount, type) VALUES (?, NULL, ?, 'import_undo')"
    ).run(po.supplier_id, -po.total_amount);
    db.prepare('DELETE FROM purchase_items WHERE purchase_order_id = ?').run(po.id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(po.id);
    db.prepare("UPDATE purchase_imports SET payload_json = NULL WHERE id = ?").run(imp.id);
    db.exec('COMMIT');
    logActivity('purchase_import_undone', 'purchase_import', imp.id, `po=${po.id} | amount=${po.total_amount}`);
    return { ok: true, message: `Import #${imp.id} undone (${items.length} line(s) reversed).` };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** The most recent import that can still be undone (for the Undo button). */
export function lastUndoableImport(): { id: number; created_at: string; supplier_id: number | null; imported_count: number } | null {
  const row = getDb()
    .prepare(
      `SELECT i.id, i.created_at, i.supplier_id, i.imported_count
       FROM purchase_imports i
       JOIN purchase_orders po ON po.import_id = i.id
       WHERE i.payload_json IS NOT NULL
       ORDER BY i.id DESC LIMIT 1`
    )
    .get() as { id: number; created_at: string; supplier_id: number | null; imported_count: number } | undefined;
  return row ?? null;
}

/** Import history (most recent first) for the Purchases screen. */
export function listPurchaseImports(limit = 20): PurchaseImportLogRow[] {
  return getDb()
    .prepare(
      `SELECT i.*, s.name AS supplier_name
       FROM purchase_imports i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       ORDER BY i.id DESC LIMIT ?`
    )
    .all(limit) as unknown as PurchaseImportLogRow[];
}

// ============================================================================
// Print / export / share a purchase order — through the ONE renderer
// ============================================================================

/** A purchase order as a document for the shared renderer. */
function purchaseOrderToSaleData(id: number): SaleData {
  const po = getPurchaseOrder(id);
  if (!po) throw new Error('Purchase order not found');
  const supplierName = po.supplier_name || `Supplier #${po.supplier_id}`;
  // The line maths comes from the shared pure module, so the printed order
  // shows exactly the numbers the PO screen showed.
  const money = (po.items || []).map((it) =>
    lineMoney({
      qty: Number(it.qty) || 0,
      unit_cost: Number(it.unit_cost) || 0,
      units_in_base: it.unit_multiplier,
      discount_pct: it.discount_pct,
      tax_pct: it.tax_pct,
    })
  );
  const sumNet = money.reduce((s, m) => round2(s + m.net), 0);
  const sumTax = money.reduce((s, m) => round2(s + m.tax), 0);
  const paid = Number(po.paid_amount) || 0;
  return {
    invoice_no: po.reference_no || `PO-${String(id).padStart(5, '0')}`,
    created_at: po.created_at || new Date().toISOString(),
    customer_name: supplierName, // the counterparty row on the document
    cashier: '',
    status: po.status,
    items: (po.items || []).map((it, i) => ({
      product_name: it.product_name || `#${it.product_id}`,
      qty: Number(it.qty) || 0,
      unit_price: Number(it.unit_cost) || 0,
      discount: money[i]?.discount ?? 0,
      tax_rate: Number(it.tax_pct) || 0,
      line_total: money[i]?.total ?? 0,
    })),
    // The document's parts add up: the lines (after their own discounts) minus
    // the order discount, plus the tax and the freight = the order total.
    subtotal: sumNet,
    discount_amount: Number(po.discount_amount) || 0,
    tax_amount: sumTax,
    service_charge: 0,
    freight: Number(po.freight) || 0,
    total_amount: Number(po.total_amount) || 0,
    paid,
    payments:
      paid > 0 && po.payment_method
        ? [{ mode: String(po.payment_method), amount: paid }]
        : [],
    returned_amount: 0,
    branch: '',
  };
}

/** Shared-renderer HTML for a purchase order (used by print preview + share). */
export function buildPurchaseOrderHtml(id: number, paper: DocumentPaper = 'a4'): string {
  const design: DocumentDesign = defaultDocumentDesign('purchase_order', paper);
  return renderDocument('purchase_order', purchaseOrderToSaleData(id), design, toShopProfile(getPrintSettings()), {
    paper,
  });
}

/**
 * Which printer slot a document paper belongs to.
 *
 * Phase 4, item 4.11 — the old rule was `paper === 'a4' ? 'invoice' : 'receipt'`,
 * so an A5 purchase order (which the IPC accepts) went to the till's THERMAL
 * receipt printer even though A5 is sheet media. A ROLL belongs to the receipt
 * printer, a SHEET to the invoice printer. Exported so the permanent suite can
 * pin the rule.
 */
export function purchaseOrderPrinterKey(paper: DocumentPaper): 'receipt' | 'invoice' {
  return paper === 'thermal80' || paper === 'thermal58' ? 'receipt' : 'invoice';
}

/**
 * Print a purchase order (A4 or thermal) through the ONE print path.
 *
 * The shop profile comes from the print settings — there is no hard-coded
 * shop name, address or logo anywhere in the document.
 */
export async function printPurchaseOrder(
  id: number,
  paper: DocumentPaper = 'a4'
): Promise<{ ok: boolean; message: string }> {
  const job = {
    html: buildPurchaseOrderHtml(id, paper),
    paper,
    printerKey: purchaseOrderPrinterKey(paper),
    jobName: 'Purchase Order',
  };
  return printDocument(job as unknown as import('./printService').PrintJob);
}

/** Preview a purchase order in the shared preview window. */
export async function previewPurchaseOrder(
  id: number,
  paper: DocumentPaper = 'a4',
  labels?: PrintPreviewLabels
): Promise<{ ok: boolean; message: string }> {
  const job = {
    html: buildPurchaseOrderHtml(id, paper),
    paper,
    printerKey: purchaseOrderPrinterKey(paper),
    jobName: 'Purchase Order',
  };
  return previewDocument(job as unknown as import('./printService').PrintJob, {
    title: 'Purchase Order preview',
    // Phase 4, item 4.16 — the preview toolbar follows the shop's language.
    printButtonLabel: labels?.print || 'Print purchase order',
    labels,
  });
}

/** Save a plain-text version (share via WhatsApp / anything that takes text). */
export async function savePurchaseOrderText(id: number, win?: BrowserWindow | null): Promise<boolean> {
  const po = getPurchaseOrder(id);
  if (!po) throw new Error('Purchase order not found');
  const lines: string[] = [];
  const s = getPrintSettings();
  if (s.shop_name) lines.push(s.shop_name);
  lines.push(`PURCHASE ${po.document_type === 'purchase_invoice' ? 'INVOICE' : 'ORDER'} ${po.reference_no || `PO-${id}`}`);
  lines.push(`Supplier: ${po.supplier_name || po.supplier_id}`);
  lines.push('--------------------------------');
  for (const it of po.items || []) {
    lines.push(`${it.product_name || `#${it.product_id}`}  ${it.qty} x ${it.unit_cost}${it.tax_pct ? ` +${it.tax_pct}% tax` : ''}`);
  }
  lines.push('--------------------------------');
  lines.push(`Total: ${po.total_amount}`);
  const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
    defaultPath: `${po.reference_no || `PO-${id}`}.txt`,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, lines.join('\r\n'), 'utf8');
  return true;
}
