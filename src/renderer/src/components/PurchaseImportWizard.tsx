import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Product,
  PurchaseImportParseResult,
  PurchaseImportSummary,
  Supplier,
} from '../../../shared/types';
import { ModalShell } from './ModalShell';
import { DateInput } from './DateInput';
import { downloadBytes } from '../utils/download';
import { fileBytesFromResult, toBase64Payload } from '../../../shared/binaryTransfer';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Phase 3 — Purchase import wizard (Excel / CSV).
 *
 * Steps: 1 Details → 2 File → 3 Map columns → 4 Match products → 5 Review →
 * 6 Confirm (summary + error report + print/share/undo).
 *
 * Design rules:
 *  - every number goes through safeNum (never NaN),
 *  - large files process in chunks with a progress bar (no UI freeze),
 *  - an error toast is shown for ANY IPC failure (no silent failures),
 *  - buttons reuse the shared .btn styles; the modal reuses ModalShell.
 */

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type FieldKey =
  | 'ignore'
  | 'barcode'
  | 'sku'
  | 'name'
  | 'qty'
  | 'unit'
  | 'cost'
  | 'sale'
  | 'wholesale'
  | 'discount'
  | 'tax'
  | 'batch'
  | 'expiry'
  | 'notes';

/**
 * The columns the owner can map a file column to.
 *
 * Phase 3, item 15 — the label is an i18n KEY, not a sentence: the wizard is
 * bilingual, so the dropdown follows the shop's language.
 */
const FIELDS: { key: FieldKey; labelKey: string }[] = [
  { key: 'ignore', labelKey: 'purchases.import.fieldIgnore' },
  { key: 'barcode', labelKey: 'purchases.import.fieldBarcode' },
  { key: 'sku', labelKey: 'purchases.import.fieldSku' },
  { key: 'name', labelKey: 'purchases.import.fieldName' },
  { key: 'qty', labelKey: 'purchases.import.fieldQty' },
  { key: 'unit', labelKey: 'purchases.import.fieldUnit' },
  { key: 'cost', labelKey: 'purchases.import.fieldCost' },
  { key: 'sale', labelKey: 'purchases.import.fieldSale' },
  { key: 'wholesale', labelKey: 'purchases.import.fieldWholesale' },
  { key: 'discount', labelKey: 'purchases.import.fieldDiscount' },
  { key: 'tax', labelKey: 'purchases.import.fieldTax' },
  { key: 'batch', labelKey: 'purchases.import.fieldBatch' },
  { key: 'expiry', labelKey: 'purchases.import.fieldExpiry' },
  { key: 'notes', labelKey: 'purchases.import.fieldNotes' },
];

/** Auto-guess dictionary: English + common Urdu/roman spellings. */
const GUESS: Record<Exclude<FieldKey, 'ignore'>, string[]> = {
  barcode: ['barcode', 'bar code', 'barcodes', 'scan code', 'code number'],
  sku: ['sku', 'item code', 'product code', 'article', 'item #', 'code'],
  name: ['product name', 'item name', 'name', 'product', 'item', 'description', 'particulars', 'naam', 'cheez', 'maal'],
  qty: ['qty', 'quantity', 'qnty', 'quantity received', 'received qty', 'pcs', 'pieces', 'miqdar', 'tadad', 'tadaad', 'quantity (pcs)'],
  unit: ['unit', 'uom', 'packing', 'pack', 'per'],
  cost: ['cost rate', 'cost', 'cost price', 'purchase rate', 'purchase price', 'buy rate', 'buy price', 'rate', 'price', 'khareed rate', 'khareed', 'lagat'],
  sale: ['sale price', 'sale', 'retail price', 'retail', 'selling price', 'sell price', 'mrp', 'bikey', 'bikri rate'],
  wholesale: ['wholesale price', 'wholesale', 'trade price', 'trade'],
  discount: ['discount %', 'discount', 'disc', 'disc%', 'rebate', 'rhaayat'],
  tax: ['tax %', 'tax', 'gst', 'sales tax', 'vat'],
  batch: ['batch', 'batch no', 'batch number', 'lot', 'lot no', 'lot number'],
  expiry: ['expiry date', 'expiry', 'exp', 'exp date', 'best before', 'expires'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments'],
};

const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();

function safeNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v === null || v === undefined) return fallback;
  const cleaned = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-+eE]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function guessField(header: string): FieldKey {
  const h = norm(header);
  if (!h) return 'ignore';
  for (const f of Object.keys(GUESS) as Exclude<FieldKey, 'ignore'>[]) {
    if (GUESS[f].includes(h)) return f;
  }
  for (const f of Object.keys(GUESS) as Exclude<FieldKey, 'ignore'>[]) {
    if (GUESS[f].some((g) => h.includes(g) || g.includes(h))) return f;
  }
  return 'ignore';
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

interface ProcessedRow {
  row: number;
  values: Record<string, string>;
  barcode: string;
  sku: string;
  name: string;
  qtyRaw: string;
  costRaw: string;
  saleRaw: string;
  wholeRaw: string;
  discRaw: string;
  taxRaw: string;
  batchRaw: string;
  expiryRaw: string;
  unitRaw: string;
  notesRaw: string;
  mode: 'matched' | 'suggested' | 'new' | 'skip';
  product_id: number | null;
  matchedName: string;
  qty: number;
  cost: number;
  /**
   * Phase 1, item 1.12 — the purchase unit of this line. When the file's
   * `unit` column names one of the product's own units (a "box" of 12), the
   * factor travels with the row so the stock is added in BASE units (24
   * pieces for "2 box", never 2).
   */
  unitsInBase: number;
  unitName: string | null;
}

/**
 * Phase 1, item 1.12 — match the file's `unit` cell against the product's own
 * units and return the factor (how many base units one of them holds).
 *
 * The rules are deliberately strict, because a wrong factor silently ruins
 * the stock:
 *   - no unit cell, or a product we do not know → 1 (the file is in base
 *     units — the safe, unchanged behaviour);
 *   - the cell names one of the product's units → that unit's factor;
 *   - the cell names the BASE unit → 1;
 *   - the cell names something we do not know → 1 (never guess).
 */
function resolveUnitFactor(product: Product | undefined, unitRaw: string): { factor: number; name: string | null } {
  const text = String(unitRaw || '').trim().toLowerCase();
  if (!product || !text) return { factor: 1, name: null };
  const units = product.units ?? [];
  if (!units.length) return { factor: 1, name: null };
  const hit = units.find((u) => String(u.name || '').trim().toLowerCase() === text);
  if (!hit) return { factor: 1, name: null };
  const factor = Number(hit.quantity_in_base_units);
  if (!Number.isFinite(factor) || factor <= 0) return { factor: 1, name: null };
  return { factor, name: hit.name ?? null };
}

function runChunked<T>(
  items: T[],
  chunk: number,
  work: (item: T, index: number) => void,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const end = Math.min(i + chunk, items.length);
      for (; i < end; i++) work(items[i], i);
      onProgress(i, items.length);
      if (i < items.length) window.setTimeout(step, 0);
      else resolve();
    };
    step();
  });
}

export default function PurchaseImportWizard({
  suppliers,
  products,
  initialFile,
  onClose,
  onDone,
}: {
  suppliers: Supplier[];
  products: Product[];
  /** Set when the file was dropped on the Purchases screen. */
  initialFile?: File | null;
  onClose: () => void;
  onDone: () => void;
}) {
  // Phase 3, item 15 — the import wizard is bilingual (en + ur).
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // step 1
  const [supplierId, setSupplierId] = useState<string>(suppliers[0] ? String(suppliers[0].id) : '');
  const [docType, setDocType] = useState<'purchase_order' | 'purchase_invoice'>('purchase_order');
  const [referenceNo, setReferenceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');

  // step 2
  const [file, setFile] = useState<PurchaseImportParseResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // step 3
  const [mapping, setMapping] = useState<Record<string, FieldKey>>({});

  // step 4-5
  const [rows, setRows] = useState<ProcessedRow[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<Record<'qty' | 'cost' | 'sale' | 'whole' | 'disc' | 'tax' | 'batch' | 'expiry', string>>>>({});

  // step 5 options
  const [options, setOptions] = useState({
    updateCostPrice: true,
    updateSalePrice: false,
    updateOnlyIfChanged: true,
    mergeDuplicates: true,
  });

  // step 6
  const [summary, setSummary] = useState<PurchaseImportSummary | null>(null);
  const [notice, setNotice] = useState('');
  const [undoable, setUndoable] = useState<{ id: number; imported_count: number } | null>(null);

  const productById = useMemo(() => {
    const m = new Map<number, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const headerByField = useMemo(() => {
    const m: Partial<Record<FieldKey, string>> = {};
    for (const [h, f] of Object.entries(mapping)) {
      if (f !== 'ignore' && m[f] === undefined) m[f] = h;
    }
    return m;
  }, [mapping]);

  // reload undo availability whenever the wizard opens / after a confirm
  useEffect(() => {
    window.api.purchases
      .importLast()
      .then((r) => setUndoable(r ? { id: r.id, imported_count: r.imported_count } : null))
      .catch(() => setUndoable(null));
  }, [summary]);

  // ── auto-map on file load ─────────────────────────────────────────────────
  useEffect(() => {
    if (!file) return;
    const m: Record<string, FieldKey> = {};
    const used = new Set<FieldKey>();
    for (const h of file.headers) {
      const g = guessField(h);
      if (g !== 'ignore' && !used.has(g)) {
        m[h] = g;
        used.add(g);
      } else {
        m[h] = 'ignore';
      }
    }
    setMapping(m);
  }, [file]);

  // ── (re)build the processed rows when mapping changes ─────────────────────
  const buildRows = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const headerFor = (k: FieldKey) => headerByField[k];
    const qtyH = headerFor('qty');
    const costH = headerFor('cost');
    const built: ProcessedRow[] = [];
    try {
      await runChunked(
        file.rows,
        200,
        (r) => {
          const get = (k: FieldKey) => (headerFor(k) ? r.values[headerFor(k)!] ?? '' : '');
          const barcode = get('barcode');
          const sku = get('sku');
          const name = get('name');
          const qtyRaw = qtyH ? r.values[qtyH] ?? '' : '';
          const costRaw = costH ? r.values[costH] ?? '' : '';

          // match: barcode → SKU → exact name → fuzzy
          let product: Product | undefined;
          let mode: ProcessedRow['mode'] = 'skip';
          if (barcode) product = products.find((p) => (p.barcode || '').trim().toLowerCase() === barcode.trim().toLowerCase());
          if (!product && sku) product = products.find((p) => (p.sku || '').trim().toLowerCase() === sku.trim().toLowerCase());
          if (!product && name) {
            const n = norm(name);
            product = products.find((p) => norm(p.name) === n);
            if (product) mode = 'matched';
            else {
              // fuzzy suggestion: closest name by distance / containment
              let best: Product | undefined;
              let bestScore = Infinity;
              for (const p of products) {
                const pn = norm(p.name);
                if (!pn) continue;
                const contains = pn.includes(n) || n.includes(pn);
                const d = contains ? 0 : levenshtein(n, pn);
                const limit = Math.max(2, Math.floor(Math.max(n.length, pn.length) * 0.35));
                if (d <= limit && d < bestScore) {
                  best = p;
                  bestScore = d;
                }
              }
              if (best) {
                product = best;
                mode = 'suggested';
              }
            }
          } else if (product) {
            mode = 'matched';
          }
          if (!product && name) mode = 'new';

          const unitRaw = get('unit');
          // Phase 1, item 1.12 — resolve the file's unit against the product's
          // own units. "2 box" of a 12-piece box is 24 base units.
          const unitFactor = resolveUnitFactor(product, unitRaw);

          built.push({
            row: r.row,
            values: r.values,
            barcode,
            sku,
            name,
            qtyRaw,
            costRaw,
            saleRaw: get('sale'),
            wholeRaw: get('wholesale'),
            discRaw: get('discount'),
            taxRaw: get('tax'),
            batchRaw: get('batch'),
            expiryRaw: get('expiry'),
            unitRaw,
            notesRaw: get('notes'),
            mode,
            product_id: product?.id ?? null,
            matchedName: product?.name ?? '',
            qty: safeNum(qtyRaw, 0),
            cost: safeNum(costRaw, 0),
            unitsInBase: unitFactor.factor,
            unitName: unitFactor.name,
          });
        },
        (done, total) => setProgress({ done, total })
      );
      setRows(built);
      setEdits({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [file, headerByField, products]);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      // The file CONTENT is sent, not a path: the web app has no file system,
      // and the web transport is JSON (so the bytes travel as base64).
      const buf = await file.arrayBuffer();
      const parsed = await window.api.purchases.importParseData(
        file.name,
        toBase64Payload(new Uint8Array(buf))
      );
      setFile(parsed);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFile = useCallback(() => {
    // The browser's own file picker — the desktop app opens the same OS
    // dialog, so there is one code path for both builds.
    fileInputRef.current?.click();
  }, []);

  // A file dropped on the Purchases screen arrives here already picked: it is
  // parsed the same way as a file chosen inside the wizard.
  useEffect(() => {
    if (!initialFile) return;
    void handleFile(initialFile);
  }, [initialFile, handleFile]);

  const downloadTemplate = useCallback(async () => {
    try {
      const res = await window.api.purchases.importTemplate();
      const bytes = fileBytesFromResult(res);
      if (bytes) {
        downloadBytes(bytes, 'purchase-import-template.xlsx', XLSX_MIME);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ── derived: editable row values ──────────────────────────────────────────
  const rowValue = (r: ProcessedRow, k: 'qty' | 'cost' | 'sale' | 'whole' | 'disc' | 'tax' | 'batch' | 'expiry') => {
    const e = edits[r.row]?.[k];
    if (e !== undefined) return e;
    switch (k) {
      case 'qty': return r.qtyRaw;
      case 'cost': return r.costRaw;
      case 'sale': return r.saleRaw;
      case 'whole': return r.wholeRaw;
      case 'disc': return r.discRaw;
      case 'tax': return r.taxRaw;
      case 'batch': return r.batchRaw;
      case 'expiry': return r.expiryRaw;
    }
  };
  const setRowValue = (row: number, k: 'qty' | 'cost' | 'sale' | 'whole' | 'disc' | 'tax' | 'batch' | 'expiry', v: string) =>
    setEdits((prev) => ({ ...prev, [row]: { ...(prev[row] || {}), [k]: v } }));

  const rowStatus = (r: ProcessedRow): { status: 'ok' | 'new' | 'warning' | 'error' | 'skipped'; text: string } => {
    if (r.mode === 'skip') return { status: 'skipped', text: t('purchases.import.statusSkipped') };
    const qty = safeNum(rowValue(r, 'qty'), NaN as unknown as number);
    if (!Number.isFinite(qty) || qty <= 0) return { status: 'error', text: t('purchases.import.statusInvalidQty') };
    if (r.mode === 'new') return { status: 'new', text: t('purchases.import.statusNewProduct') };
    if (safeNum(rowValue(r, 'cost'), 0) <= 0) return { status: 'warning', text: t('purchases.import.statusCostZero') };
    if (r.mode === 'suggested') {
      return { status: 'warning', text: t('purchases.import.statusFuzzy', { name: r.matchedName }) };
    }
    return { status: 'ok', text: t('purchases.import.statusOk') };
  };

  const totals = useMemo(() => {
    let count = 0;
    let qty = 0;
    let amount = 0;
    for (const r of rows) {
      const st = rowStatus(r);
      if (st.status === 'skipped' || st.status === 'error') continue;
      count++;
      const q = safeNum(rowValue(r, 'qty'), 0);
      const c = safeNum(rowValue(r, 'cost'), 0);
      const d = safeNum(rowValue(r, 'disc'), 0);
      const t = safeNum(rowValue(r, 'tax'), 0);
      const gross = q * c;
      qty += q;
      amount += (gross - (gross * d) / 100) * (1 + t / 100);
    }
    return { count, qty, amount: Math.round(amount * 100) / 100 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, edits]);

  // ── bulk actions ──────────────────────────────────────────────────────────
  const setMode = (row: number, mode: ProcessedRow['mode'], product_id: number | null) =>
    setRows((prev) => prev.map((r) => (r.row === row ? { ...r, mode, product_id, matchedName: product_id ? productById.get(product_id)?.name ?? '' : '' } : r)));
  const acceptAllSuggestions = () => setRows((prev) => prev.map((r) => (r.mode === 'suggested' && r.product_id ? { ...r, mode: 'matched' } : r)));
  const createAllUnmatched = () => setRows((prev) => prev.map((r) => (r.mode === 'skip' || r.mode === 'new' ? (r.name ? { ...r, mode: 'new', product_id: null } : r) : r)));
  const skipAllUnmatched = () => setRows((prev) => prev.map((r) => (r.mode === 'suggested' || r.mode === 'new' ? { ...r, mode: 'skip', product_id: null } : r)));

  // ── confirm ───────────────────────────────────────────────────────────────
  const confirm = useCallback(async () => {
    if (!supplierId) return setError(t('purchases.import.errChooseSupplier'));
    const payloadRows = rows
      .filter((r) => rowStatus(r).status !== 'skipped' && rowStatus(r).status !== 'error')
      .map((r) => ({
        row: r.row,
        product_id: r.mode === 'new' ? null : r.product_id,
        create_new: r.mode === 'new' ? { name: r.name || `Imported product ${r.row}`, barcode: r.barcode || undefined, sku: r.sku || undefined } : null,
        qty: rowValue(r, 'qty'),
        unit_cost: rowValue(r, 'cost'),
        sale_price: rowValue(r, 'sale'),
        wholesale_price: rowValue(r, 'whole'),
        discount_pct: rowValue(r, 'disc'),
        tax_pct: rowValue(r, 'tax'),
        batch_no: rowValue(r, 'batch') || null,
        expiry_date: rowValue(r, 'expiry') || null,
        notes: r.notesRaw || null,
        // Phase 1, item 1.12 — the purchase unit travels with the line.
        units_in_base: r.unitsInBase,
        unit_name: r.unitName,
      }));
    if (!payloadRows.length) return setError(t('purchases.import.errNothingToImport'));

    setBusy(true);
    setError(null);
    try {
      const result = await window.api.purchases.importConfirm({
        supplier_id: Number(supplierId),
        document_type: docType,
        reference_no: referenceNo || null,
        invoice_date: invoiceDate || null,
        file_name: file?.file_name ?? null,
        options,
        rows: payloadRows,
      });
      setSummary(result);
      setStep(6);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [supplierId, rows, docType, referenceNo, invoiceDate, file, options, onDone, t]);

  const downloadErrors = useCallback(async () => {
    if (!summary?.errors?.length) return;
    try {
      const res = await window.api.exportData.saveCsv(
        'purchase-import-errors.csv',
        ['Row', 'Problem'],
        summary.errors.map((e) => [e.row, e.message])
      );
      const bytes = fileBytesFromResult(res);
      if (bytes) downloadBytes(bytes, 'purchase-import-errors.csv', 'text/csv;charset=utf-8');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [summary]);

  const undoImport = useCallback(async () => {
    if (!summary?.import_id) return;
    setBusy(true);
    try {
      const r = await window.api.purchases.importUndo(summary.import_id);
      setNotice(r.message);
      setSummary({ ...summary, purchase_order_id: null });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [summary, onDone]);

  const shareOrder = useCallback(async () => {
    if (!summary?.purchase_order_id) return;
    try {
      const text = await window.api.purchases.shareOrder(summary.purchase_order_id);
      // The HTML is for printing; for sharing we copy a plain-text version.
      await navigator.clipboard?.writeText(
        text
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
      setNotice(t('purchases.import.copied'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [summary, t]);

  const steps: { id: string; label: string; n: Step }[] = [
    { id: 's1', label: t('purchases.import.stepDetails'), n: 1 },
    { id: 's2', label: t('purchases.import.stepFile'), n: 2 },
    { id: 's3', label: t('purchases.import.stepColumns'), n: 3 },
    { id: 's4', label: t('purchases.import.stepMatch'), n: 4 },
    { id: 's5', label: t('purchases.import.stepReview'), n: 5 },
    { id: 's6', label: t('purchases.import.stepDone'), n: 6 },
  ];

  const canNext: Record<Step, boolean> = {
    1: !!supplierId,
    2: !!file,
    3: !!headerByField.qty,
    4: rows.length > 0,
    5: totals.count > 0,
    6: false,
  };

  return (
    <ModalShell
      title={t('purchases.import.title')}
      tabs={steps.map((s) => ({ id: s.id, label: s.label }))}
      activeId={steps[step - 1].id}
      onSelect={(id) => {
        const n = (steps.find((s) => s.id === id)?.n ?? 1) as Step;
        if (n < step || step === 6) setStep(n);
      }}
      error={error}
      onClose={onClose}
      onSubmit={() => {
        if (step === 5) void confirm();
        else if (step === 6) onClose();
        else if (canNext[step]) {
          if (step === 3) void buildRows();
          setStep((s) => (Math.min(6, s + 1) as Step));
        } else {
          setError(
            step === 1
              ? t('purchases.import.errChooseSupplier')
              : step === 2
                ? t('purchases.import.errPickFile')
                : t('purchases.import.errMapQty')
          );
        }
      }}
      submitLabel={step === 5 ? t('purchases.import.confirmImport') : step === 6 ? t('purchases.import.close') : t('purchases.import.next')}
      className="import-wizard"
      label={t('purchases.import.label')}
    >
      {progress && (
        <div style={{ marginBottom: 8 }}>
          <div className="muted small">
            {t('purchases.import.processing', { done: progress.done, total: progress.total })}
          </div>
          <progress value={progress.done} max={Math.max(1, progress.total)} style={{ width: '100%' }} />
        </div>
      )}
      {notice && <div className="notice">{notice} <button className="btn btn-sm" onClick={() => setNotice('')}>OK</button></div>}

      {/* ── 1 · Details ── */}
      {step === 1 && (
        <div className="form-row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label>{t('purchases.import.supplier')}</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('purchases.import.chooseSupplier')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label>{t('purchases.import.docType')}</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value as 'purchase_order' | 'purchase_invoice')}>
              <option value="purchase_order">{t('purchases.import.docTypeOrder')}</option>
              <option value="purchase_invoice">{t('purchases.import.docTypeInvoice')}</option>
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 160 }}>
            <label>{t('purchases.import.referenceNo')}</label>
            <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder={t('purchases.import.referencePlaceholder')} />
          </div>
          <div className="form-group" style={{ minWidth: 160 }}>
            <label>{t('purchases.import.invoiceDate')}</label>
            <DateInput
              value={invoiceDate}
              onChange={setInvoiceDate}
              placeholder={t('purchases.import.invoiceDate')}
            />
          </div>
        </div>
      )}

      {/* ── 2 · File ── */}
      {step === 2 && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
              else setError(t('purchases.import.couldNotReadFile'));
            }}
            style={{
              border: `2px dashed ${dragOver ? 'var(--primary)' : '#cbd5e1'}`,
              borderRadius: 8,
              padding: '28px 16px',
              textAlign: 'center',
              background: dragOver ? 'rgba(59,130,246,0.06)' : '#f8fafc',
            }}
          >
            <div style={{ fontSize: 30, marginBottom: 6 }}>📄</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('purchases.import.dropHere')}</div>
            <div className="row-btns" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={pickFile} disabled={busy}>
                {t('purchases.import.chooseFile')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void downloadTemplate()}
              >
                {t('purchases.import.downloadTemplate')}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                // Reset so the same file can be picked again.
                e.target.value = '';
              }}
            />
          </div>
          {file && (
            <div className="muted small" style={{ marginTop: 8 }}>
              {t('purchases.import.loaded', {
                file: file.file_name,
                sheet: file.sheet,
                header: file.header_row,
                rows: file.rows.length,
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 3 · Columns ── */}
      {step === 3 && file && (
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            {t('purchases.import.autoGuessed')}
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('purchases.import.fileColumn')}</th>
                  <th>{t('purchases.import.firstValue')}</th>
                  <th>{t('purchases.import.mapsTo')}</th>
                </tr>
              </thead>
              <tbody>
                {file.headers.map((h) => (
                  <tr key={h}>
                    <td>{h || <span className="muted">{t('purchases.import.blank')}</span>}</td>
                    <td className="muted">{file.rows[0]?.values[h] ?? ''}</td>
                    <td>
                      <select
                        value={mapping[h] ?? 'ignore'}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as FieldKey }))}
                      >
                        {FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>{t(f.labelKey)}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!headerByField.qty && (
            <div className="notice error">{t('purchases.import.mapQty')}</div>
          )}
        </div>
      )}

      {/* ── 4 · Match ── */}
      {step === 4 && (
        <div>
          <div className="row-btns" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={acceptAllSuggestions}>
              {t('purchases.import.acceptAllSuggestions')}
            </button>
            <button type="button" className="btn btn-sm" onClick={createAllUnmatched}>
              {t('purchases.import.createAllUnmatched')}
            </button>
            <button type="button" className="btn btn-sm" onClick={skipAllUnmatched}>
              {t('purchases.import.skipAllUnmatched')}
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('purchases.import.row')}</th>
                  <th>{t('purchases.import.fromFile')}</th>
                  <th>{t('purchases.import.matchedTo')}</th>
                  <th>{t('purchases.import.action')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>
                      {r.name || r.barcode || r.sku || <span className="muted">{t('purchases.import.blank')}</span>}
                      <div className="muted small">{[r.barcode, r.sku].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>
                      {r.mode === 'matched' || r.mode === 'suggested' ? (
                        <span className={r.mode === 'suggested' ? 'text-warn' : ''}>
                          {r.matchedName}
                          {r.mode === 'suggested' ? t('purchases.import.check') : ''}
                        </span>
                      ) : r.mode === 'new' ? (
                        <span className="text-ok">{t('purchases.import.willBeCreated')}</span>
                      ) : (
                        <span className="muted">{t('purchases.import.noMatch')}</span>
                      )}
                    </td>
                    <td>
                      <select
                        value={r.mode === 'new' ? 'new' : r.mode === 'skip' ? 'skip' : `p:${r.product_id}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'new') setMode(r.row, 'new', null);
                          else if (v === 'skip') setMode(r.row, 'skip', null);
                          else setMode(r.row, 'matched', Number(v.slice(2)));
                        }}
                      >
                        <option value="skip">{t('purchases.import.skipRow')}</option>
                        <option value="new">{t('purchases.import.createNewProduct')}</option>
                        {products.slice(0, 300).map((p) => (
                          <option key={p.id} value={`p:${p.id}`}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 500 && (
            <div className="muted small">{t('purchases.import.showingFirst', { rows: rows.length })}</div>
          )}
        </div>
      )}

      {/* ── 5 · Review ── */}
      {step === 5 && (
        <div>
          <div className="row-btns" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <label className="muted small">
              <input
                type="checkbox"
                checked={options.updateCostPrice}
                onChange={(e) => setOptions((o) => ({ ...o, updateCostPrice: e.target.checked }))}
              />{' '}
              {t('purchases.import.updateCostPrice')}
            </label>
            <label className="muted small">
              <input
                type="checkbox"
                checked={options.updateSalePrice}
                onChange={(e) => setOptions((o) => ({ ...o, updateSalePrice: e.target.checked }))}
              />{' '}
              {t('purchases.import.updateSalePrice')}
            </label>
            <label className="muted small">
              <input
                type="checkbox"
                checked={options.updateOnlyIfChanged}
                onChange={(e) => setOptions((o) => ({ ...o, updateOnlyIfChanged: e.target.checked }))}
              />{' '}
              {t('purchases.import.updateOnlyIfChanged')}
            </label>
            <label className="muted small">
              <input
                type="checkbox"
                checked={options.mergeDuplicates}
                onChange={(e) => setOptions((o) => ({ ...o, mergeDuplicates: e.target.checked }))}
              />{' '}
              {t('purchases.import.mergeDuplicates')}
            </label>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('purchases.import.row')}</th>
                  <th>{t('purchases.import.product')}</th>
                  <th>{t('purchases.import.status')}</th>
                  <th className="num">{t('purchases.import.qty')}</th>
                  <th className="num">{t('purchases.import.cost')}</th>
                  <th className="num">{t('purchases.import.sale')}</th>
                  <th className="num">{t('purchases.import.discPct')}</th>
                  <th className="num">{t('purchases.import.taxPct')}</th>
                  <th>{t('purchases.import.batch')}</th>
                  <th>{t('purchases.import.expiry')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => {
                  const st = rowStatus(r);
                  return (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>
                        {r.mode === 'new' ? (
                          <span className="text-ok">{r.name}{t('purchases.import.newSuffix')}</span>
                        ) : r.product_id ? (
                          productById.get(r.product_id)?.name ?? r.matchedName
                        ) : (
                          r.name
                        )}
                      </td>
                      <td>
                        <span
                          className={
                            st.status === 'ok' ? 'text-ok' : st.status === 'error' ? 'text-danger' : st.status === 'skipped' ? 'muted' : 'text-warn'
                          }
                        >
                          {st.text}
                        </span>
                      </td>
                      <td className="num"><input className="line-price-input" style={{ width: 70, borderColor: st.status === 'error' ? 'var(--danger)' : undefined }} value={rowValue(r, 'qty')} onChange={(e) => setRowValue(r.row, 'qty', e.target.value)} /></td>
                      <td className="num"><input className="line-price-input" style={{ width: 80 }} value={rowValue(r, 'cost')} onChange={(e) => setRowValue(r.row, 'cost', e.target.value)} /></td>
                      <td className="num"><input className="line-price-input" style={{ width: 80 }} value={rowValue(r, 'sale')} onChange={(e) => setRowValue(r.row, 'sale', e.target.value)} /></td>
                      <td className="num"><input className="line-price-input" style={{ width: 60 }} value={rowValue(r, 'disc')} onChange={(e) => setRowValue(r.row, 'disc', e.target.value)} /></td>
                      <td className="num"><input className="line-price-input" style={{ width: 60 }} value={rowValue(r, 'tax')} onChange={(e) => setRowValue(r.row, 'tax', e.target.value)} /></td>
                      <td><input className="line-price-input" style={{ width: 90 }} value={rowValue(r, 'batch')} onChange={(e) => setRowValue(r.row, 'batch', e.target.value)} /></td>
                      <td><input className="line-price-input" style={{ width: 110 }} value={rowValue(r, 'expiry')} onChange={(e) => setRowValue(r.row, 'expiry', e.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted small" style={{ marginTop: 8, textAlign: 'right' }}>
            {t('purchases.import.summary', {
              count: totals.count,
              qty: Number(totals.qty.toFixed(3)),
              amount: totals.amount.toLocaleString(),
            })}
          </div>
        </div>
      )}

      {/* ── 6 · Done ── */}
      {step === 6 && summary && (
        <div>
          <div className="panel" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('purchases.import.importComplete')}</div>
            <div>
              {t('purchases.import.importedSummary', {
                imported: summary.imported,
                created: summary.created,
                skipped: summary.skipped,
                failed: summary.failed,
              })}
            </div>
            {summary.purchase_order_id && (
              <div className="row-btns" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" onClick={() => window.api.purchases.previewOrder(summary.purchase_order_id!).catch((e) => setError(String(e)))}>
                  {t('purchases.import.previewPrint')}
                </button>
                <button type="button" className="btn btn-sm" onClick={shareOrder}>
                  {t('purchases.import.copyWhatsApp')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => window.api.purchases.saveOrderText(summary.purchase_order_id!).catch((e) => setError(String(e)))}>
                  {t('purchases.import.saveAsText')}
                </button>
                {summary.import_id && (
                  <button type="button" className="btn btn-sm btn-danger" onClick={undoImport} disabled={busy}>
                    {t('purchases.import.undoImport')}
                  </button>
                )}
              </div>
            )}
            {summary.errors.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="text-warn" style={{ fontWeight: 600 }}>
                  {t('purchases.import.rowsFailed', { count: summary.errors.length })}
                </div>
                <ul className="muted small" style={{ margin: '4px 0 8px 16px' }}>
                  {summary.errors.slice(0, 8).map((e) => (
                    <li key={e.row}>{t('purchases.import.rowFailed', { row: e.row, message: e.message })}</li>
                  ))}
                </ul>
                <button type="button" className="btn btn-sm" onClick={downloadErrors}>
                  {t('purchases.import.downloadErrors')}
                </button>
              </div>
            )}
            {undoable && !summary.purchase_order_id && (
              <div className="muted small" style={{ marginTop: 8 }}>
                {t('purchases.import.stillUndoable', { id: undoable.id })}
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
