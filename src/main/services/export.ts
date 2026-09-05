import { dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { getDb } from '../db';
import { formatDateYMD } from '../utils/timezone';
import { createProduct, listProducts } from './inventory';
import { listSales } from './sales';
import { listCustomers } from './sales';
import { listPurchaseOrders, getPurchaseOrder } from './purchases';
import { listExpenses } from './reports';
import { listCategories, listUnits } from './inventory';
import type { ProductImportError, ProductImportResult } from '../../shared/types';

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function saveCsv(
  win: BrowserWindow | null,
  defaultName: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<boolean> {
  const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
    defaultPath: defaultName,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return false;
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\r\n'), 'utf8');
  return true;
}

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
}

function toDateValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return formatDateYMD(v);
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : formatDateYMD(d);
}

export function saveXlsx(win: BrowserWindow | null, defaultName: string, sheets: XlsxSheet[]): Promise<boolean> {
  return (async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: defaultName,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return false;
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]);
      ws['!cols'] = s.headers.map((h) => ({ wch: Math.max(10, Math.min(40, h.length + 6)) }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    XLSX.writeFile(wb, filePath);
    return true;
  })();
}

export function exportProductsXlsx(
  win: BrowserWindow | null,
  search?: string,
  includeInactive = true,
  categoryId?: number,
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock',
  supplierId?: number,
  expiryFrom?: string,
  expiryTo?: string
): Promise<boolean> {
  const products = listProducts(search, includeInactive, categoryId, stockStatus, supplierId, expiryFrom, expiryTo);
  return saveXlsx(win, 'products.xlsx', [
    {
      name: 'Inventory',
      headers: ['ID', 'Name', 'SKU', 'Barcode', 'Category', 'Unit', 'Cost Price', 'Sale Price', 'Wholesale Price', 'Shelf Location', 'Stock Qty', 'Low Stock At', 'Tax %', 'Expiry Date', 'Status'],
      rows: products.map((p) => [
        p.id,
        p.name,
        p.sku ?? '',
        p.barcode ?? '',
        p.category_name ?? '',
        p.unit_name ?? '',
        p.cost_price,
        p.sale_price,
        p.wholesale_price ?? '',
        p.shelf_location ?? '',
        p.stock_qty,
        p.low_stock_threshold,
        p.tax_rate,
        p.expiry_date ?? '',
        p.active ? 'Active' : 'Inactive',
      ]),
    },
  ]);
}

export function exportSalesXlsx(win: BrowserWindow | null, from?: string, to?: string): Promise<boolean> {
  const sales = listSales(from, to);
  return saveXlsx(win, 'sales-report.xlsx', [
    {
      name: 'Sales',
      headers: ['Invoice', 'Date', 'Customer', 'Status', 'Subtotal', 'Tax', 'Discount', 'Total', 'Service Charge', 'Service Charge Type', 'Freight', 'Price Overridden', 'Notes'],
      rows: sales.map((s) => [
        s.invoice_no,
        s.created_at ?? '',
        s.customer_name ?? '',
        s.status,
        s.subtotal,
        s.tax_amount,
        s.discount_amount,
        s.total_amount,
        s.service_charge ?? '',
        s.service_charge_type ?? '',
        s.freight ?? '',
        (s as any).price_overridden ? 'Yes' : 'No',
        s.notes ?? '',
      ]),
    },
  ]);
}

export function exportCustomersXlsx(win: BrowserWindow | null, status?: 'paid' | 'pending' | 'all', from?: string, to?: string): Promise<boolean> {
  const customers = listCustomers(status, from, to);
  return saveXlsx(win, 'customers.xlsx', [
    {
      name: 'Customers',
      headers: ['ID', 'Name', 'Phone', 'Address', 'Balance', 'Credit Limit'],
      rows: customers.map((c) => [c.id, c.name, c.phone ?? '', c.address ?? '', c.balance, c.credit_limit ?? '']),
    },
  ]);
}

export function exportPurchaseOrdersXlsx(win: BrowserWindow | null, status?: string, from?: string, to?: string, supplierId?: number): Promise<boolean> {
  const orders = listPurchaseOrders(status, from, to, supplierId);
  const orderRows = orders.map((o) => [o.id, o.created_at ?? '', o.supplier_name ?? '', o.status, o.total_amount]);
  const itemRows: (string | number | null)[][] = [];
  for (const o of orders) {
    const full = getPurchaseOrder(o.id);
    if (!full) continue;
    for (const it of full.items) {
      itemRows.push([o.id, o.created_at ?? '', o.supplier_name ?? '', it.product_name ?? `#${it.product_id}`, it.qty, it.unit_cost, it.qty * it.unit_cost]);
    }
  }
  return saveXlsx(win, 'purchase-orders.xlsx', [
    { name: 'Orders', headers: ['Order ID', 'Date', 'Supplier', 'Status', 'Total'], rows: orderRows },
    { name: 'Order Items', headers: ['Order ID', 'Date', 'Supplier', 'Product', 'Qty', 'Unit Cost', 'Line Total'], rows: itemRows },
  ]);
}

export function exportExpensesXlsx(win: BrowserWindow | null, from?: string, to?: string): Promise<boolean> {
  const expenses = listExpenses(from, to);
  return saveXlsx(win, 'expenses.xlsx', [
    {
      name: 'Expenses',
      headers: ['Date', 'Title', 'Category', 'Amount', 'Notes'],
      rows: expenses.map((e) => [e.expense_date, e.title, e.category, e.amount, e.notes ?? '']),
    },
  ]);
}

export function downloadProductTemplate(win: BrowserWindow | null): Promise<boolean> {
  const categories = listCategories().map((c) => c.name).join(', ');
  const units = listUnits().map((u) => u.name).join(', ');
  return saveXlsx(win, 'product-import-template.xlsx', [
    {
      name: 'Products',
      headers: ['Name*', 'Sale Price*', 'Cost Price', 'Wholesale Price', 'Shelf Location', 'Stock Qty', 'Barcode', 'SKU', 'Category', 'Unit', 'Tax %', 'Expiry Date', 'Low Stock At'],
      rows: [
        ['Example Product A', 150, 100, 120, 'Aisle 1, Rack 2', 50, '896000000001', 'SKU-001', 'Grocery', 'pcs', 0, '2027-12-31', 10],
        ['Example Product B', 250, 180, 200, '', 20, '896000000002', 'SKU-002', 'Beverages', 'bottle', 0, '', 5],
      ],
    },
    {
      name: 'Instructions',
      headers: ['Field', 'Required', 'Notes'],
      rows: [
        ['Name*', 'Yes', 'Product display name'],
        ['Sale Price*', 'Yes', 'Selling price (number, >= 0)'],
        ['Cost Price', 'No', 'Purchase cost; default 0'],
        ['Wholesale Price', 'No', 'Wholesale selling price; blank = retail price used in wholesale mode'],
        ['Shelf Location', 'No', 'Shelf / rack location, e.g. "Aisle 2, Rack 3"'],
        ['Stock Qty', 'No', 'Initial stock; default 0'],
        ['Barcode', 'No', 'Must be unique. Leave blank to auto-generate'],
        ['SKU', 'No', 'Must be unique. Leave blank to auto-generate'],
        ['Category', 'No', `Existing category name, e.g. ${categories || 'Grocery'}; created if missing`],
        ['Unit', 'No', `Existing unit name, e.g. ${units || 'pcs'}; ignored if unknown`],
        ['Tax %', 'No', 'Number between 0 and 100; default 0'],
        ['Expiry Date', 'No', 'YYYY-MM-DD'],
        ['Low Stock At', 'No', 'Low-stock alert threshold; default 0'],
      ],
    },
  ]);
}

const IMPORT_HEADERS: Record<string, string> = {
  name: 'name',
  'name*': 'name',
  'product name': 'name',
  'sale price': 'sale_price',
  'sale price*': 'sale_price',
  price: 'sale_price',
  'cost price': 'cost_price',
  cost: 'cost_price',
  'wholesale price': 'wholesale_price',
  wholesale: 'wholesale_price',
  'shelf location': 'shelf_location',
  shelf: 'shelf_location',
  'stock qty': 'stock_qty',
  stock: 'stock_qty',
  quantity: 'stock_qty',
  barcode: 'barcode',
  sku: 'sku',
  category: 'category',
  unit: 'unit',
  'tax %': 'tax_rate',
  tax: 'tax_rate',
  'expiry date': 'expiry_date',
  expiry: 'expiry_date',
  'low stock at': 'low_stock_threshold',
  'low stock': 'low_stock_threshold',
  'low stock threshold': 'low_stock_threshold',
};

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isFinite(n) ? n : null;
}

function findCategoryId(db: ReturnType<typeof getDb>, name: string): number {
  const existing = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name.trim());
  return Number(info.lastInsertRowid);
}

function findUnitId(db: ReturnType<typeof getDb>, name: string): number | null {
  const unit = db.prepare('SELECT id FROM units WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined;
  return unit ? unit.id : null;
}

export function importProductsFromExcel(win: BrowserWindow | null): Promise<ProductImportResult | null> {
  return (async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined!, {
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;

    const wb = XLSX.readFile(filePaths[0], { cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { inserted: 0, errors: [{ row: 0, message: 'Workbook has no sheets' }] };
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true });
    if (aoa.length < 2) return { inserted: 0, errors: [{ row: 0, message: 'Sheet is empty (needs a header row and at least one data row)' }] };

    const headerRow = aoa[0].map((h) => String(h ?? '').trim().toLowerCase());
    const colOf = new Map<string, number>();
    headerRow.forEach((h, i) => {
      if (h && IMPORT_HEADERS[h] && !colOf.has(IMPORT_HEADERS[h])) colOf.set(IMPORT_HEADERS[h], i);
    });
    if (!colOf.has('name') || !colOf.has('sale_price')) {
      return { inserted: 0, errors: [{ row: 0, message: 'Missing required columns: Name and Sale Price (header row must include "Name" and "Sale Price")' }] };
    }

    const db = getDb();
    const result: ProductImportResult = { inserted: 0, errors: [] };
    const seenBarcodes = new Set<string>();
    const seenSkus = new Set<string>();
    const checkExisting = db.prepare('SELECT id FROM products WHERE barcode = ? OR sku = ? LIMIT 1');

    for (let r = 1; r < aoa.length; r++) {
      const raw = aoa[r];
      if (!Array.isArray(raw) || raw.every((v) => v === null || v === undefined || v === '')) continue;
      const rowNo = r + 1;
      const get = (key: string) => {
        const i = colOf.get(key);
        return i !== undefined ? raw[i] : undefined;
      };

      const name = String(get('name') ?? '').trim();
      const salePrice = parseNumber(get('sale_price'));
      const costPrice = parseNumber(get('cost_price'));
      const wholesalePrice = parseNumber(get('wholesale_price'));
      const shelfLocation = String(get('shelf_location') ?? '').trim();
      const stockQty = parseNumber(get('stock_qty'));
      const taxRate = parseNumber(get('tax_rate'));
      const threshold = parseNumber(get('low_stock_threshold'));
      const barcode = String(get('barcode') ?? '').trim();
      const sku = String(get('sku') ?? '').trim();
      const expiryRaw = get('expiry_date');
      const expiry = toDateValue(expiryRaw);
      const categoryName = String(get('category') ?? '').trim();
      const unitName = String(get('unit') ?? '').trim();

      const errors: string[] = [];
      if (!name) errors.push('Name is required');
      if (salePrice === null || salePrice < 0) errors.push('Sale Price must be a number >= 0');
      if (costPrice !== null && costPrice < 0) errors.push('Cost Price must be a number >= 0');
      if (wholesalePrice !== null && wholesalePrice < 0) errors.push('Wholesale Price must be a number >= 0');
      if (stockQty !== null && (!Number.isInteger(stockQty) || stockQty < 0)) errors.push('Stock Qty must be a whole number >= 0');
      if (taxRate !== null && (taxRate < 0 || taxRate > 100)) errors.push('Tax % must be between 0 and 100');
      if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0)) errors.push('Low Stock At must be a whole number >= 0');
      if (expiryRaw !== undefined && expiryRaw !== null && expiryRaw !== '' && !expiry) errors.push('Expiry Date must be a valid date (YYYY-MM-DD)');
      if (barcode && seenBarcodes.has(barcode)) errors.push(`Barcode "${barcode}" appears multiple times in this file`);
      if (sku && seenSkus.has(sku)) errors.push(`SKU "${sku}" appears multiple times in this file`);
      if (barcode && !seenBarcodes.has(barcode) && checkExisting.get(barcode, null)) errors.push(`Barcode "${barcode}" already exists in inventory`);
      if (sku && !seenSkus.has(sku) && checkExisting.get(null, sku)) errors.push(`SKU "${sku}" already exists in inventory`);

      if (errors.length) {
        result.errors.push({ row: rowNo, message: errors.join('; ') });
        continue;
      }

      if (barcode) seenBarcodes.add(barcode);
      if (sku) seenSkus.add(sku);
      let categoryId: number | null = null;
      if (categoryName) {
        try {
          categoryId = findCategoryId(db, categoryName);
        } catch {
          result.errors.push({ row: rowNo, message: `Failed to create category "${categoryName}"` });
          continue;
        }
      }

      try {
        db.exec('BEGIN');
        const inserted = createProduct({
          name,
          sale_price: salePrice ?? 0,
          cost_price: costPrice ?? 0,
          wholesale_price: wholesalePrice,
          shelf_location: shelfLocation || null,
          stock_qty: stockQty ?? 0,
          barcode: barcode || undefined,
          sku: sku || undefined,
          tax_rate: taxRate ?? 0,
          low_stock_threshold: threshold ?? 0,
          expiry_date: expiry,
          category_id: categoryId,
          unit_id: unitName ? findUnitId(db, unitName) : null,
        });
        db.exec('COMMIT');
        if (inserted) result.inserted++;
      } catch (e) {
        db.exec('ROLLBACK');
        result.errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
      }
    }

    return result;
  })();
}
