import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Product,
  PurchaseImportParseResult,
  PurchaseImportSummary,
  Supplier,
} from '../../../shared/types';
import { ModalShell } from './ModalShell';

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

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'ignore', label: '— ignore —' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'sku', label: 'SKU / Item code' },
  { key: 'name', label: 'Product name' },
  { key: 'qty', label: 'Quantity' },
  { key: 'unit', label: 'Unit' },
  { key: 'cost', label: 'Cost rate' },
  { key: 'sale', label: 'Sale price' },
  { key: 'wholesale', label: 'Wholesale price' },
  { key: 'discount', label: 'Discount %' },
  { key: 'tax', label: 'Tax %' },
  { key: 'batch', label: 'Batch' },
  { key: 'expiry', label: 'Expiry date' },
  { key: 'notes', label: 'Notes' },
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
  initialFilePath,
  onClose,
  onDone,
}: {
  suppliers: Supplier[];
  products: Product[];
  /** Set when the file was dropped on the Purchases screen. */
  initialFilePath?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
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

  // A file dropped on the Purchases screen arrives here already parsed.
  useEffect(() => {
    if (!initialFilePath) return;
    let alive = true;
    (async () => {
      setBusy(true);
      try {
        const parsed = await window.api.purchases.importParse(initialFilePath);
        if (!alive) return;
        setFile(parsed);
        setStep(3);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilePath]);

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
            unitRaw: get('unit'),
            notesRaw: get('notes'),
            mode,
            product_id: product?.id ?? null,
            matchedName: product?.name ?? '',
            qty: safeNum(qtyRaw, 0),
            cost: safeNum(costRaw, 0),
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

  const handleFile = useCallback(
    async (filePath: string) => {
      setBusy(true);
      setError(null);
      try {
        const parsed = await window.api.purchases.importParse(filePath);
        setFile(parsed);
        setStep(3);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const pickFile = useCallback(async () => {
    try {
      const p = await window.api.purchases.importPickFile();
      if (p) await handleFile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [handleFile]);

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
    if (r.mode === 'skip') return { status: 'skipped', text: 'Skipped' };
    const qty = safeNum(rowValue(r, 'qty'), NaN as unknown as number);
    if (!Number.isFinite(qty) || qty <= 0) return { status: 'error', text: 'Invalid qty' };
    if (r.mode === 'new') return { status: 'new', text: 'New product' };
    if (safeNum(rowValue(r, 'cost'), 0) <= 0) return { status: 'warning', text: 'Cost is 0' };
    if (r.mode === 'suggested') return { status: 'warning', text: `Fuzzy → ${r.matchedName}` };
    return { status: 'ok', text: 'OK' };
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
    if (!supplierId) return setError('Choose a supplier first');
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
      }));
    if (!payloadRows.length) return setError('Nothing to import — every row is skipped or invalid');

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
  }, [supplierId, rows, docType, referenceNo, invoiceDate, file, options, onDone]);

  const downloadErrors = useCallback(async () => {
    if (!summary?.errors?.length) return;
    try {
      await window.api.exportData.saveCsv(
        'purchase-import-errors.csv',
        ['Row', 'Problem'],
        summary.errors.map((e) => [e.row, e.message])
      );
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
      setNotice('Purchase order copied to the clipboard — paste it into WhatsApp.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [summary]);

  const steps: { id: string; label: string; n: Step }[] = [
    { id: 's1', label: '1 · Details', n: 1 },
    { id: 's2', label: '2 · File', n: 2 },
    { id: 's3', label: '3 · Columns', n: 3 },
    { id: 's4', label: '4 · Match', n: 4 },
    { id: 's5', label: '5 · Review', n: 5 },
    { id: 's6', label: '6 · Done', n: 6 },
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
      title="Import purchases from file"
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
          setError(step === 1 ? 'Choose a supplier first' : step === 2 ? 'Pick a file first' : 'Map at least the Quantity column');
        }
      }}
      submitLabel={step === 5 ? 'Confirm import' : step === 6 ? 'Close' : 'Next'}
      className="import-wizard"
      label="Purchase import"
    >
      {progress && (
        <div style={{ marginBottom: 8 }}>
          <div className="muted small">
            Processing rows… {progress.done}/{progress.total}
          </div>
          <progress value={progress.done} max={Math.max(1, progress.total)} style={{ width: '100%' }} />
        </div>
      )}
      {notice && <div className="notice">{notice} <button className="btn btn-sm" onClick={() => setNotice('')}>OK</button></div>}

      {/* ── 1 · Details ── */}
      {step === 1 && (
        <div className="form-row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label>Supplier *</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— choose —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label>Document type *</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value as 'purchase_order' | 'purchase_invoice')}>
              <option value="purchase_order">Purchase Order — stock changes when received</option>
              <option value="purchase_invoice">Purchase Invoice — stock changes now</option>
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 160 }}>
            <label>Reference no.</label>
            <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="e.g. INV-778" />
          </div>
          <div className="form-group" style={{ minWidth: 160 }}>
            <label>Invoice date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
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
              const f = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
              if (f?.path) void handleFile(f.path);
              else setError('Could not read the dropped file path.');
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
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Drag & drop an .xlsx / .xls / .csv file here</div>
            <div className="row-btns" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={pickFile} disabled={busy}>
                Choose file…
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => window.api.purchases.importTemplate().catch((e) => setError(String(e)))}
              >
                Download sample template
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0] as (File & { path?: string }) | undefined;
                if (f?.path) void handleFile(f.path);
              }}
            />
          </div>
          {file && (
            <div className="muted small" style={{ marginTop: 8 }}>
              Loaded <b>{file.file_name}</b> — sheet “{file.sheet}”, header row {file.header_row}, {file.rows.length} data row(s).
            </div>
          )}
        </div>
      )}

      {/* ── 3 · Columns ── */}
      {step === 3 && file && (
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Auto-guessed from the header row. Adjust any column that was read wrongly.
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>File column</th>
                  <th>First value</th>
                  <th>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {file.headers.map((h) => (
                  <tr key={h}>
                    <td>{h || <span className="muted">(blank)</span>}</td>
                    <td className="muted">{file.rows[0]?.values[h] ?? ''}</td>
                    <td>
                      <select
                        value={mapping[h] ?? 'ignore'}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as FieldKey }))}
                      >
                        {FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!headerByField.qty && <div className="notice error">Map one column to “Quantity” to continue.</div>}
        </div>
      )}

      {/* ── 4 · Match ── */}
      {step === 4 && (
        <div>
          <div className="row-btns" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={acceptAllSuggestions}>Accept all fuzzy matches</button>
            <button type="button" className="btn btn-sm" onClick={createAllUnmatched}>Create products for all unmatched</button>
            <button type="button" className="btn btn-sm" onClick={skipAllUnmatched}>Skip all unmatched</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>From file</th>
                  <th>Matched to</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>
                      {r.name || r.barcode || r.sku || <span className="muted">(blank)</span>}
                      <div className="muted small">{[r.barcode, r.sku].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>
                      {r.mode === 'matched' || r.mode === 'suggested' ? (
                        <span className={r.mode === 'suggested' ? 'text-warn' : ''}>
                          {r.matchedName}
                          {r.mode === 'suggested' ? ' (check)' : ''}
                        </span>
                      ) : r.mode === 'new' ? (
                        <span className="text-ok">Will be created</span>
                      ) : (
                        <span className="muted">No match</span>
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
                        <option value="skip">Skip row</option>
                        <option value="new">Create new product</option>
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
          {rows.length > 500 && <div className="muted small">Showing the first 500 of {rows.length} rows — all rows import.</div>}
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
              Update product cost price
            </label>
            <label className="muted small">
              <input
                type="checkbox"
                checked={options.updateSalePrice}
                onChange={(e) => setOptions((o) => ({ ...o, updateSalePrice: e.target.checked }))}
              />{' '}
              Update sale price from file
            </label>
            <label className="muted small">
              <input
                type="checkbox"
                checked={options.updateOnlyIfChanged}
                onChange={(e) => setOptions((o) => ({ ...o, updateOnlyIfChanged: e.target.checked }))}
              />{' '}
              Update only if changed
            </label>
            <label className="muted small">
              <input
                type="checkbox"
                checked={options.mergeDuplicates}
                onChange={(e) => setOptions((o) => ({ ...o, mergeDuplicates: e.target.checked }))}
              />{' '}
              Merge duplicates
            </label>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th className="num">Qty</th>
                  <th className="num">Cost</th>
                  <th className="num">Sale</th>
                  <th className="num">Disc %</th>
                  <th className="num">Tax %</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => {
                  const st = rowStatus(r);
                  return (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>
                        {r.mode === 'new' ? <span className="text-ok">{r.name} (new)</span> : r.product_id ? productById.get(r.product_id)?.name ?? r.matchedName : r.name}
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
            {totals.count} line(s) · {Number(totals.qty.toFixed(3))} qty · total {totals.amount.toLocaleString()}
          </div>
        </div>
      )}

      {/* ── 6 · Done ── */}
      {step === 6 && summary && (
        <div>
          <div className="panel" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Import complete</div>
            <div>
              Imported <b>{summary.imported}</b> line(s) · created <b>{summary.created}</b> product(s) · skipped{' '}
              <b>{summary.skipped}</b> · failed <b>{summary.failed}</b>
            </div>
            {summary.purchase_order_id && (
              <div className="row-btns" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" onClick={() => window.api.purchases.previewOrder(summary.purchase_order_id!).catch((e) => setError(String(e)))}>
                  Preview / print
                </button>
                <button type="button" className="btn btn-sm" onClick={shareOrder}>
                  Copy for WhatsApp
                </button>
                <button type="button" className="btn btn-sm" onClick={() => window.api.purchases.saveOrderText(summary.purchase_order_id!).catch((e) => setError(String(e)))}>
                  Save as text
                </button>
                {summary.import_id && (
                  <button type="button" className="btn btn-sm btn-danger" onClick={undoImport} disabled={busy}>
                    Undo this import
                  </button>
                )}
              </div>
            )}
            {summary.errors.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="text-warn" style={{ fontWeight: 600 }}>{summary.errors.length} row(s) failed</div>
                <ul className="muted small" style={{ margin: '4px 0 8px 16px' }}>
                  {summary.errors.slice(0, 8).map((e) => (
                    <li key={e.row}>Row {e.row}: {e.message}</li>
                  ))}
                </ul>
                <button type="button" className="btn btn-sm" onClick={downloadErrors}>
                  Download error report (CSV)
                </button>
              </div>
            )}
            {undoable && !summary.purchase_order_id && (
              <div className="muted small" style={{ marginTop: 8 }}>
                Last import #{undoable.id} is still undoable from the Purchases screen.
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
