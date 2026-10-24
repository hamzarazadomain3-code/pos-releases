/**
 * Document Designer — shared design model (Phase 2.3+).
 *
 * A `DocumentDesign` is the editable description of any printable document:
 * an ordered list of sections (built-in blocks + custom blocks), plus table/global options.
 * It is pure data (JSON-safe) so it can live in `admin_settings`, cross IPC, and
 * be normalised identically in the main process (which renders) and the renderer
 * (which previews/edits).
 *
 * IMPORTANT: this module must stay dependency-free (no `node:` / `electron`), so
 * both processes can import it.
 */

// ============================================================================
// Phase 2.3: Document Types & Paper Types
// ============================================================================

/** Document type enum with 11 supported document types */
export type DocumentType =
  | 'receipt'           // Thermal receipt (80mm/58mm)
  | 'invoice'           // A4/A5 invoice
  | 'quotation'         // Quotation/estimate
  | 'return'            // Return/refund receipt
  | 'purchase_order'    // Purchase order
  | 'delivery_challan'  // Delivery challan / gate pass
  | 'credit_slip'       // Credit slip (udhaar)
  | 'payment_receipt'   // Payment received receipt
  | 'customer_ledger'   // Customer ledger statement
  | 'shift_report'      // Shift report (X/Z)
  | 'barcode_label';    // Barcode label (via Label Studio)

/** Paper types for documents */
export type DocumentPaper =
  | 'thermal80' | 'thermal58'
  | 'a4' | 'a5';

/** Paper options with metadata */
export const DOCUMENT_PAPERS: Array<{ value: DocumentPaper; label: string; widthMm: number }> = [
  { value: 'thermal80', label: 'Thermal 80mm', widthMm: 80 },
  { value: 'thermal58', label: 'Thermal 58mm', widthMm: 58 },
  { value: 'a4', label: 'A4 Invoice', widthMm: 210 },
  { value: 'a5', label: 'A5 Invoice', widthMm: 148 },
];

/** Default paper for each document type */
export const DEFAULT_PAPER_FOR_TYPE: Record<DocumentType, DocumentPaper> = {
  receipt: 'thermal80',
  invoice: 'a4',
  quotation: 'a4',
  return: 'thermal80',
  purchase_order: 'a4',
  delivery_challan: 'a4',
  credit_slip: 'thermal80',
  payment_receipt: 'thermal80',
  customer_ledger: 'a4',
  shift_report: 'thermal80',
  barcode_label: 'thermal80',
};

/** Document types that use thermal paper */
export const THERMAL_TYPES: DocumentType[] = ['receipt', 'return', 'credit_slip', 'payment_receipt', 'shift_report', 'barcode_label'];

/** Document types that use A4/A5 paper */
export const SHEET_TYPES: DocumentType[] = ['invoice', 'quotation', 'purchase_order', 'delivery_challan', 'customer_ledger'];

/** Document type labels for UI */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  quotation: 'Quotation / Estimate',
  return: 'Return / Refund',
  purchase_order: 'Purchase Order',
  delivery_challan: 'Delivery Challan / Gate Pass',
  credit_slip: 'Credit Slip (Udhaar)',
  payment_receipt: 'Payment Receipt',
  customer_ledger: 'Customer Ledger',
  shift_report: 'Shift Report (X/Z)',
  barcode_label: 'Barcode Label',
};

// ============================================================================
// Block Types
// ============================================================================

/** All block types the designer can place (built-in + custom) */
export type BlockType =
  // built-in sections
  | 'logo'
  | 'shop_name'
  | 'address'
  | 'phone_whatsapp'
  | 'tax_no'
  | 'header_note'
  | 'meta'
  | 'items_table'
  | 'totals'
  | 'payment'
  | 'qr'
  | 'footer_note_1'
  | 'footer_note_2'
  | 'software_credit'
  | 'return_banner'
  // Phase 5 built-in sections
  | 'loyalty'
  | 'return_policy'
  | 'thank_you'
  | 'savings'
  | 'fbr_qr'
  // custom blocks
  | 'text'
  | 'divider'
  | 'image'
  | 'barcode'
  | 'spacer'
  | 'two_col'
  | 'banner';

/** Human-readable labels for each block type */
export const BLOCK_LABELS: Record<BlockType, string> = {
  logo: 'Logo',
  shop_name: 'Shop name',
  address: 'Address',
  phone_whatsapp: 'Phone / WhatsApp',
  tax_no: 'Tax no. (NTN/STRN)',
  header_note: 'Header note',
  meta: 'Meta (customer / invoice / date)',
  items_table: 'Items table',
  totals: 'Totals',
  payment: 'Payment',
  qr: 'QR / Barcode (invoice no.)',
  footer_note_1: 'Footer note 1',
  footer_note_2: 'Footer note 2',
  software_credit: 'Software credit',
  return_banner: 'Return / refund banner (auto)',
  // Phase 5
  loyalty: 'Loyalty points',
  return_policy: 'Return policy',
  thank_you: 'Thank you (auto per language)',
  savings: 'You saved',
  fbr_qr: 'FBR e-Invoice QR',
  text: 'Text',
  divider: 'Divider',
  image: 'Image',
  barcode: 'Barcode',
  spacer: 'Spacer',
  two_col: 'Two-column label : value',
  banner: 'Banner',
};

/** Which block types are available for each document type */
export const BLOCK_TYPES_FOR_DOCUMENT: Record<DocumentType, BlockType[]> = {
  receipt: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit', 'return_banner',
    'loyalty', 'return_policy', 'thank_you', 'savings', 'fbr_qr',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  invoice: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit', 'return_banner',
    'return_policy', 'thank_you', 'savings', 'fbr_qr',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  quotation: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit',
    'return_policy', 'thank_you', 'savings',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  return: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit', 'return_banner',
    'return_policy', 'thank_you',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  purchase_order: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit',
    'return_policy', 'thank_you',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  delivery_challan: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  credit_slip: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit', 'return_banner',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  payment_receipt: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  customer_ledger: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  shift_report: [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'meta', 'items_table', 'totals', 'payment',
    'footer_note_1', 'footer_note_2', 'software_credit',
    'text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner',
  ],
  barcode_label: [
    'logo', 'shop_name', 'address', 'phone_whatsapp',
    'qr', 'barcode',
    'text', 'divider', 'image', 'spacer', 'two_col', 'banner',
  ],
};

/** Block types that can be added more than once (custom blocks) */
export const CUSTOM_BLOCK_TYPES: BlockType[] = [
  'text',
  'divider',
  'image',
  'barcode',
  'spacer',
  'two_col',
  'banner',
];

/** Which custom block types are available for each document type */
export const CUSTOM_BLOCK_TYPES_FOR_DOCUMENT: Record<DocumentType, BlockType[]> = {
  receipt: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  invoice: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  quotation: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  return: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  purchase_order: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  delivery_challan: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  credit_slip: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  payment_receipt: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  customer_ledger: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  shift_report: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
  barcode_label: ['text', 'divider', 'image', 'barcode', 'spacer', 'two_col', 'banner'],
};

/** Built-in block types (non-custom) */
export const BUILTIN_BLOCK_TYPES = Object.keys(BLOCK_LABELS).filter(k => !CUSTOM_BLOCK_TYPES.includes(k as BlockType)) as BlockType[];

// ============================================================================
// Legacy aliases for backward compatibility
// ============================================================================

/** @deprecated Use DocumentType instead */
export type ReceiptBlockType = BlockType;
/** @deprecated Use DOCUMENT_PAPERS instead */
export const RECEIPT_PAPERS = DOCUMENT_PAPERS;
/** @deprecated Use DocumentPaper instead */
export type ReceiptPaper = DocumentPaper;
/** @deprecated Use BLOCK_TYPES_FOR_DOCUMENT.receipt instead */
export const RECEIPT_BLOCK_TYPES = BLOCK_TYPES_FOR_DOCUMENT.receipt;
/** @deprecated Use CUSTOM_BLOCK_TYPES_FOR_DOCUMENT.receipt instead */
export const CUSTOM_BLOCK_TYPES_RECEIPT = CUSTOM_BLOCK_TYPES_FOR_DOCUMENT.receipt;

// ============================================================================
// Core Types (shared)
// ============================================================================

export type Align = 'left' | 'center' | 'right';

export interface BlockStyle {
  fontFamily?: string;
  fontSizePx?: number;
  bold?: boolean;
  italic?: boolean;
  align?: Align;
  uppercase?: boolean;
  lineHeight?: number;
  marginTopMm?: number;
  marginBottomMm?: number;
  maxHeightMm?: number;
}

/** Generic block interface used by DocumentDesign */
export interface Block {
  id: string;
  type: BlockType;
  enabled: boolean;
  /** Free text for `text`/`header_note`/footer notes; tokens allowed. */
  text?: string;
  /** `two_col` left cell. */
  label?: string;
  /** `two_col` right cell / `barcode` payload. */
  value?: string;
  /** `divider`: dashed | solid | double | blank. */
  variant?: string;
  /** `image`: data URL or http(s)/file path. */
  src?: string;
  /** `spacer`: height in mm. */
  heightMm?: number;
  style?: BlockStyle;
  /** Per-branch overrides for address block. */
  branchOverrides?: Record<string, string>;
}

/** Legacy alias for ReceiptBlock */
export type ReceiptBlock = Block;

export type TableColumnKey = 'no' | 'name' | 'unit' | 'qty' | 'rate' | 'disc' | 'tax' | 'amt';

export const DEFAULT_TABLE_COLUMN_LABELS: Record<TableColumnKey, string> = {
  no: '#',
  name: 'Item',
  unit: 'Unit',
  qty: 'Qty',
  rate: 'Rate',
  disc: 'Disc',
  tax: 'Tax',
  amt: 'Amount',
};

/** Legacy alias */
export const TABLE_COLUMN_LABELS = DEFAULT_TABLE_COLUMN_LABELS;

export interface TableColumn {
  key: TableColumnKey;
  enabled: boolean;
  /** Optional explicit width, e.g. "36%". Empty = auto. */
  width?: string;
}

export interface TableOptions {
  columns: TableColumn[];
  showHeader: boolean;
  rowSeparators: boolean;
  fontSizePx?: number;
  boldItemNames: boolean;
  urduNameUnderEnglish: boolean;
}

/** Default labels for meta block and other built-in text. Can be overridden per template. */
export const DEFAULT_META_LABELS = {
  customer: 'CUSTOMER',
  cashier: 'CASHIER',
  date: 'DATE',
  time: 'TIME',
  invoice: 'INVOICE',
  subtotal: 'SUB TOTAL',
  discount: 'DISCOUNT',
  tax: 'TAX',
  serviceCharge: 'SERVICE CHARGE',
  freight: 'FREIGHT',
  netTotal: 'NET TOTAL',
  paid: 'PAID',
  change: 'CHANGE',
  balance: 'UDHAAR/BALANCE',
  return: 'RETURN',
  customerLabel: 'CUSTOMER',
  cashierLabel: 'CASHIER',
  dateLabel: 'DATE',
  timeLabel: 'TIME',
  invoiceLabel: 'INVOICE',
} as const;

export type MetaLabelKey = keyof typeof DEFAULT_META_LABELS;

export interface GlobalOptions {
  paperWidthMm?: number;
  marginMm?: number;
  baseFontSizePx?: number;
  /** ESC/POS chars-per-line hint (stored for the print layer). */
  charsPerLine?: number;
  currencySymbol?: string;
  currencyPosition?: 'before' | 'after';
  decimals?: number;
  thousandSeparator?: boolean;
  dateFormat?: string;
  /** Urdu font family used for Urdu/RTL blocks. */
  urduFontFamily?: string;
  /** Custom labels for table columns. Keys match TableColumnKey. */
  columnLabels?: Partial<Record<TableColumnKey, string>>;
  /** Custom labels for meta block and built-in text. Keys match MetaLabelKey. */
  metaLabels?: Partial<Record<MetaLabelKey, string>>;
}

// ============================================================================
// Document Design (new)
// ============================================================================

/** Design for any document type */
export interface DocumentDesign {
  schemaVersion: number;
  documentType: DocumentType;
  paper: DocumentPaper;
  global: GlobalOptions;
  table: TableOptions;
  sections: Block[];
  /** Per-branch overrides keyed by branch id (string), falling back to default. */
  branchOverrides?: Record<string, Partial<Pick<DocumentDesign, 'global' | 'table' | 'sections'>>>;
}

/** Current schema version */
export const DESIGN_SCHEMA_VERSION = 1;

// ============================================================================
// Legacy ReceiptDesign (backward compatible)
// ============================================================================

/** @deprecated Use DocumentDesign instead */
export interface ReceiptDesign {
  schemaVersion: number;
  paper: ReceiptPaper;
  global: GlobalOptions;
  table: TableOptions;
  sections: ReceiptBlock[];
  /** Per-branch overrides keyed by branch id (string), falling back to default. */
  branchOverrides?: Record<string, Partial<Pick<ReceiptDesign, 'global' | 'table' | 'sections'>>>;
}

/** @deprecated Use DESIGN_SCHEMA_VERSION instead */
export const RECEIPT_DESIGN_SCHEMA_VERSION = DESIGN_SCHEMA_VERSION;

/** Tokens a text/footer block may use; resolved against the sale. */
export const TOKENS = [
  'shop', 'address', 'phone', 'whatsapp', 'customer', 'cashier',
  'invoice', 'date', 'time', 'total', 'paid', 'balance', 'branch',
  'prev_balance', 'new_balance', 'loyalty_points', 'savings',
  'custom1', 'custom2', 'custom3',
];

/** @deprecated Use TOKENS instead */
export const RECEIPT_TOKENS = TOKENS;

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

/** The built-in block order that reproduces the shipped thermal receipt. */
export function defaultSections(documentType: DocumentType = 'receipt'): Block[] {
  const built = (type: BlockType, enabled = true): Block => ({
    id: `b-${type}`,
    type,
    enabled,
  });
  const dividerIn = (): Block => ({ id: nextId('div'), type: 'divider', enabled: true, variant: 'dashed' });

  // Get allowed block types for this document type
  const allowedTypes = BLOCK_TYPES_FOR_DOCUMENT[documentType] || BLOCK_TYPES_FOR_DOCUMENT.receipt;

  const sections: Block[] = [];

  // Add standard sections in order, only if allowed for this document type
  const standardOrder: BlockType[] = [
    'logo', 'shop_name', 'address', 'phone_whatsapp', 'tax_no', 'header_note',
    'return_banner', 'meta', 'items_table', 'totals', 'payment', 'qr',
    'footer_note_1', 'footer_note_2', 'software_credit', 'qr', 'fbr_qr',
    'loyalty', 'savings', 'return_policy', 'thank_you', 'return_banner',
  ];

  for (const type of standardOrder) {
    if (allowedTypes.includes(type)) {
      sections.push(built(type));
      if (type === 'header_note' || type === 'meta' || type === 'items_table' ||
          type === 'totals' || type === 'payment' || type === 'footer_note_1' || type === 'footer_note_2') {
        sections.push(dividerIn());
      }
    }
  }

  return sections;
}

export function defaultTableOptions(): TableOptions {
  return {
    columns: [
      { key: 'no', enabled: true },
      { key: 'name', enabled: true },
      { key: 'unit', enabled: false },
      { key: 'qty', enabled: true },
      { key: 'rate', enabled: true },
      { key: 'disc', enabled: true },
      { key: 'tax', enabled: false },
      { key: 'amt', enabled: true },
    ],
    showHeader: true,
    rowSeparators: false,
    fontSizePx: 13,
    boldItemNames: true,
    urduNameUnderEnglish: false,
  };
}

export function defaultGlobalOptions(): GlobalOptions {
  return {
    paperWidthMm: 80,
    marginMm: 4,
    baseFontSizePx: 13,
    charsPerLine: 32,
    currencySymbol: 'Rs',
    currencyPosition: 'before',
    decimals: 2,
    thousandSeparator: true,
    dateFormat: 'dd/mm/yyyy',
    urduFontFamily: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif",
    columnLabels: {},
    metaLabels: {},
  };
}

export function defaultDocumentDesign(documentType: DocumentType = 'receipt', paper?: DocumentPaper): DocumentDesign {
  const g = defaultGlobalOptions();
  const defaultPaper = paper || DEFAULT_PAPER_FOR_TYPE[documentType];
  g.paperWidthMm = DOCUMENT_PAPERS.find((p) => p.value === defaultPaper)?.widthMm ?? 80;
  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentType,
    paper: defaultPaper,
    global: g,
    table: defaultTableOptions(),
    sections: defaultSections(documentType),
    branchOverrides: {},
  };
}

// Backward compatibility aliases
export function defaultReceiptDesign(paper: ReceiptPaper = 'thermal80'): DocumentDesign {
  return defaultDocumentDesign('receipt', paper);
}

// ============================================================================
// Normalization & Utilities
// ============================================================================

function asBool(v: unknown, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return dflt;
}

function asNum(v: unknown, dflt: number | undefined): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
}

const BLOCK_TYPES = new Set<string>(Object.keys(BLOCK_LABELS));

/** Tolerant normaliser: unknown fields are ignored, missing ones defaulted. */
export function normalizeReceiptDesign(raw: unknown): ReceiptDesign {
  const base = defaultReceiptDesign();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<ReceiptDesign>;

  const paper: ReceiptPaper =
    r.paper && RECEIPT_PAPERS.some((p) => p.value === r.paper) ? r.paper : base.paper;

  const g = { ...base.global };
  if (r.global && typeof r.global === 'object') {
    const rg = r.global as unknown as Record<string, unknown>;
    if (rg.paperWidthMm !== undefined) g.paperWidthMm = asNum(rg.paperWidthMm, g.paperWidthMm);
    if (rg.marginMm !== undefined) g.marginMm = asNum(rg.marginMm, g.marginMm);
    if (rg.baseFontSizePx !== undefined) g.baseFontSizePx = asNum(rg.baseFontSizePx, g.baseFontSizePx);
    if (rg.charsPerLine !== undefined) g.charsPerLine = asNum(rg.charsPerLine, g.charsPerLine);
    if (typeof rg.currencySymbol === 'string') g.currencySymbol = rg.currencySymbol;
    if (rg.currencyPosition === 'before' || rg.currencyPosition === 'after') g.currencyPosition = rg.currencyPosition;
    if (rg.decimals !== undefined) g.decimals = asNum(rg.decimals, g.decimals);
    if (rg.thousandSeparator !== undefined) g.thousandSeparator = asBool(rg.thousandSeparator, !!g.thousandSeparator);
    if (typeof rg.dateFormat === 'string') g.dateFormat = rg.dateFormat;
    if (typeof rg.urduFontFamily === 'string') g.urduFontFamily = rg.urduFontFamily;
    if (rg.columnLabels && typeof rg.columnLabels === 'object') g.columnLabels = rg.columnLabels as Partial<Record<TableColumnKey, string>>;
    if (rg.metaLabels && typeof rg.metaLabels === 'object') g.metaLabels = rg.metaLabels as Partial<Record<MetaLabelKey, string>>;
  }

  const t: TableOptions = defaultTableOptions();
  if (r.table && typeof r.table === 'object') {
    const rt = r.table as unknown as Record<string, unknown>;
    if (Array.isArray(rt.columns)) {
      const within = (rt.columns as Array<Record<string, unknown>>)
        .filter((c) => c && TABLECOLS.has(String(c.key)))
        .map((c) => {
          const key = String(c.key) as TableColumnKey;
          const def = t.columns.find((x) => x.key === key);
          return {
            key,
            enabled: asBool(c.enabled, def ? def.enabled : true),
            width: typeof c.width === 'string' ? c.width : undefined,
          } as TableColumn;
        });
      // Preserve designer order, but drop dupes; re-add any standard columns the
      // payload omitted so an old design cannot silently lose a column.
      const seen = new Set(within.map((c) => c.key));
      for (const c of t.columns) if (!seen.has(c.key)) within.push({ ...c });
      if (within.length) t.columns = within;
    }
    if (rt.showHeader !== undefined) t.showHeader = asBool(rt.showHeader, t.showHeader);
    if (rt.rowSeparators !== undefined) t.rowSeparators = asBool(rt.rowSeparators, t.rowSeparators);
    if (rt.fontSizePx !== undefined) t.fontSizePx = asNum(rt.fontSizePx, t.fontSizePx);
    if (rt.boldItemNames !== undefined) t.boldItemNames = asBool(rt.boldItemNames, t.boldItemNames);
    if (rt.urduNameUnderEnglish !== undefined) t.urduNameUnderEnglish = asBool(rt.urduNameUnderEnglish, t.urduNameUnderEnglish);
  }

  let sections = base.sections;
  if (Array.isArray(r.sections)) {
    const cleaned = (r.sections as unknown as Array<Record<string, unknown>>)
      .filter((s) => s && BLOCK_TYPES.has(String(s.type)))
      .map((s) => normalizeBlock(s));
    if (cleaned.length) sections = cleaned;
  }

  let branchOverrides: ReceiptDesign['branchOverrides'];
  if (r.branchOverrides && typeof r.branchOverrides === 'object') {
    branchOverrides = r.branchOverrides as ReceiptDesign['branchOverrides'];
  }

  return { schemaVersion: RECEIPT_DESIGN_SCHEMA_VERSION, paper, global: g, table: t, sections, branchOverrides };
}

/** Normalize a DocumentDesign (new) */
export function normalizeDocumentDesign(raw: unknown, documentType: DocumentType = 'receipt'): DocumentDesign {
  const base = defaultDocumentDesign(documentType);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<DocumentDesign>;

  const paper: DocumentPaper =
    r.paper && DOCUMENT_PAPERS.some((p) => p.value === r.paper) ? r.paper : base.paper;

  const g = { ...base.global };
  if (r.global && typeof r.global === 'object') {
    const rg = r.global as unknown as Record<string, unknown>;
    if (rg.paperWidthMm !== undefined) g.paperWidthMm = asNum(rg.paperWidthMm, g.paperWidthMm);
    if (rg.marginMm !== undefined) g.marginMm = asNum(rg.marginMm, g.marginMm);
    if (rg.baseFontSizePx !== undefined) g.baseFontSizePx = asNum(rg.baseFontSizePx, g.baseFontSizePx);
    if (rg.charsPerLine !== undefined) g.charsPerLine = asNum(rg.charsPerLine, g.charsPerLine);
    if (typeof rg.currencySymbol === 'string') g.currencySymbol = rg.currencySymbol;
    if (rg.currencyPosition === 'before' || rg.currencyPosition === 'after') g.currencyPosition = rg.currencyPosition;
    if (rg.decimals !== undefined) g.decimals = asNum(rg.decimals, g.decimals);
    if (rg.thousandSeparator !== undefined) g.thousandSeparator = asBool(rg.thousandSeparator, !!g.thousandSeparator);
    if (typeof rg.dateFormat === 'string') g.dateFormat = rg.dateFormat;
    if (typeof rg.urduFontFamily === 'string') g.urduFontFamily = rg.urduFontFamily;
    if (rg.columnLabels && typeof rg.columnLabels === 'object') g.columnLabels = rg.columnLabels as Partial<Record<TableColumnKey, string>>;
    if (rg.metaLabels && typeof rg.metaLabels === 'object') g.metaLabels = rg.metaLabels as Partial<Record<MetaLabelKey, string>>;
  }

  const t: TableOptions = defaultTableOptions();
  if (r.table && typeof r.table === 'object') {
    const rt = r.table as unknown as Record<string, unknown>;
    if (Array.isArray(rt.columns)) {
      const within = (rt.columns as Array<Record<string, unknown>>)
        .filter((c) => c && TABLECOLS.has(String(c.key)))
        .map((c) => {
          const key = String(c.key) as TableColumnKey;
          const def = t.columns.find((x) => x.key === key);
          return {
            key,
            enabled: asBool(c.enabled, def ? def.enabled : true),
            width: typeof c.width === 'string' ? c.width : undefined,
          } as TableColumn;
        });
      const seen = new Set(within.map((c) => c.key));
      for (const c of t.columns) if (!seen.has(c.key)) within.push({ ...c });
      if (within.length) t.columns = within;
    }
    if (rt.showHeader !== undefined) t.showHeader = asBool(rt.showHeader, t.showHeader);
    if (rt.rowSeparators !== undefined) t.rowSeparators = asBool(rt.rowSeparators, t.rowSeparators);
    if (rt.fontSizePx !== undefined) t.fontSizePx = asNum(rt.fontSizePx, t.fontSizePx);
    if (rt.boldItemNames !== undefined) t.boldItemNames = asBool(rt.boldItemNames, t.boldItemNames);
    if (rt.urduNameUnderEnglish !== undefined) t.urduNameUnderEnglish = asBool(rt.urduNameUnderEnglish, t.urduNameUnderEnglish);
  }

  let sections = base.sections;
  if (Array.isArray(r.sections)) {
    const allowedTypes = BLOCK_TYPES_FOR_DOCUMENT[documentType] || BLOCK_TYPES_FOR_DOCUMENT.receipt;
    const cleaned = (r.sections as unknown as Array<Record<string, unknown>>)
      .filter((s) => s && allowedTypes.includes(String(s.type) as BlockType))
      .map((s) => normalizeBlock(s));
    if (cleaned.length) sections = cleaned;
  }

  let branchOverrides: DocumentDesign['branchOverrides'];
  if (r.branchOverrides && typeof r.branchOverrides === 'object') {
    branchOverrides = r.branchOverrides as DocumentDesign['branchOverrides'];
  }

  return { schemaVersion: DESIGN_SCHEMA_VERSION, documentType, paper, global: g, table: t, sections, branchOverrides };
}

const TABLECOLS = new Set<string>(Object.keys(DEFAULT_TABLE_COLUMN_LABELS));

function normalizeBlock(s: Record<string, unknown>): Block {
  const type = String(s.type) as BlockType;
  const b: Block = {
    id: typeof s.id === 'string' && s.id ? s.id : nextId('blk'),
    type,
    enabled: asBool(s.enabled, true),
  };
  if (typeof s.text === 'string') b.text = s.text;
  if (typeof s.label === 'string') b.label = s.label;
  if (typeof s.value === 'string') b.value = s.value;
  if (typeof s.variant === 'string') b.variant = s.variant;
  if (typeof s.src === 'string') b.src = s.src;
  if (s.heightMm !== undefined) b.heightMm = asNum(s.heightMm, undefined);
  if (s.style && typeof s.style === 'object') {
    const rs = s.style as Record<string, unknown>;
    const st: BlockStyle = {};
    if (typeof rs.fontFamily === 'string') st.fontFamily = rs.fontFamily;
    if (rs.fontSizePx !== undefined) st.fontSizePx = asNum(rs.fontSizePx, undefined);
    if (rs.bold !== undefined) st.bold = asBool(rs.bold, false);
    if (rs.italic !== undefined) st.italic = asBool(rs.italic, false);
    if (rs.align === 'left' || rs.align === 'center' || rs.align === 'right') st.align = rs.align;
    if (rs.uppercase !== undefined) st.uppercase = asBool(rs.uppercase, false);
    if (rs.lineHeight !== undefined) st.lineHeight = asNum(rs.lineHeight, undefined);
    if (rs.marginTopMm !== undefined) st.marginTopMm = asNum(rs.marginTopMm, undefined);
    if (rs.marginBottomMm !== undefined) st.marginBottomMm = asNum(rs.marginBottomMm, undefined);
    if (rs.maxHeightMm !== undefined) st.maxHeightMm = asNum(rs.maxHeightMm, undefined);
    b.style = st;
  }
  if (s.branchOverrides && typeof s.branchOverrides === 'object') {
    const bo: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.branchOverrides as Record<string, unknown>)) {
      if (typeof v === 'string') bo[k] = v;
    }
    if (Object.keys(bo).length > 0) b.branchOverrides = bo;
  }
  return b;
}

/** Deep clone (JSON-safe by construction). */
export function cloneDesign(d: DocumentDesign): DocumentDesign {
  return JSON.parse(JSON.stringify(d)) as DocumentDesign;
}

/** @deprecated Use cloneDesign instead */
export function cloneReceiptDesign(d: ReceiptDesign): ReceiptDesign {
  return JSON.parse(JSON.stringify(d)) as ReceiptDesign;
}

/** CSS text for a block's style, or '' when nothing is set. */
export function blockStyleCss(style: BlockStyle | undefined): string {
  if (!style) return '';
  const parts: string[] = [];
  if (style.fontFamily) parts.push(`font-family:${style.fontFamily}`);
  if (style.fontSizePx) parts.push(`font-size:${style.fontSizePx}px`);
  if (style.bold) parts.push('font-weight:800');
  if (style.italic) parts.push('font-style:italic');
  if (style.align) parts.push(`text-align:${style.align}`);
  if (style.uppercase) parts.push('text-transform:uppercase');
  if (style.lineHeight) parts.push(`line-height:${style.lineHeight}`);
  if (style.marginTopMm != null) parts.push(`margin-top:${style.marginTopMm}mm`);
  if (style.marginBottomMm != null) parts.push(`margin-bottom:${style.marginBottomMm}mm`);
  return parts.join(';');
}

/** Replace `{token}` placeholders. Unknown tokens are left intact. */
export function applyTokens(
  text: string,
  tokens: Record<string, string | undefined>
): string {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? (tokens[key] ?? '') : m
  );
}

// ============================================================================
// Template Library (Phase 3)
// ============================================================================

/**
 * A named saved design. `builtin` entries are always re-seeded from
 * `builtinTemplates()` on load, so they can never be lost or corrupted; only
 * custom entries are persisted.
 */
export interface TemplateEntry {
  id: string;
  name: string;
  design: DocumentDesign;
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** @deprecated Use TemplateEntry instead */
export interface ReceiptTemplateEntry {
  id: string;
  name: string;
  design: ReceiptDesign;
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The whole template store: named templates + default-per-document-type (+ per-branch). */
export interface DocumentLibrary {
  schemaVersion: number;
  templates: TemplateEntry[];
  /** Global default template id per document type (absent ⇒ the Phase-2 applied design). */
  documentTypeDefaults: Partial<Record<DocumentType, string>>;
  /** Legacy: Global default template id per paper size (absent ⇒ the Phase-2 applied design). */
  defaults: Partial<Record<DocumentPaper, string>>;
  /** Per-branch default overrides: branchId → paper → template id. */
  branchDefaults: Record<string, Partial<Record<DocumentPaper, string>>>;
}

/** @deprecated Use DocumentLibrary instead */
export interface ReceiptLibrary {
  schemaVersion: number;
  templates: ReceiptTemplateEntry[];
  /** Global default template id per paper size (absent ⇒ the Phase-2 applied design). */
  defaults: Partial<Record<ReceiptPaper, string>>;
  /** Per-branch default overrides: branchId → paper → template id. */
  branchDefaults: Record<string, Partial<Record<ReceiptPaper, string>>>;
}

export const LIBRARY_SCHEMA_VERSION = 1;

/** @deprecated Use LIBRARY_SCHEMA_VERSION instead */
export const RECEIPT_LIBRARY_SCHEMA_VERSION = LIBRARY_SCHEMA_VERSION;

const BUILTIN_TEMPLATE_IDS = [
  'builtin-compact-80',
  'builtin-detailed-80',
  'builtin-mini-58',
  'builtin-a4-invoice',
  'builtin-bakery',
  'builtin-return-refund',
] as const;

function tuneDesign(base: DocumentDesign, fn: (d: DocumentDesign) => void): DocumentDesign {
  const d = cloneDesign(base);
  fn(d);
  return d;
}

function setSectionEnabled(d: DocumentDesign, type: BlockType, on: boolean): void {
  const s = d.sections.find((b) => b.type === type);
  if (s) s.enabled = on;
}

function setColumnEnabled(d: DocumentDesign, key: TableColumnKey, on: boolean): void {
  const c = d.table.columns.find((x) => x.key === key);
  if (c) c.enabled = on;
}

/** The six shipped starting points. Deterministic (fixed ids, no clock). */
export function builtinTemplates(): TemplateEntry[] {
  const mk = (id: string, name: string, design: DocumentDesign): TemplateEntry => ({
    id,
    name,
    design,
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  });

  const compact = tuneDesign(defaultDocumentDesign('receipt', 'thermal80'), (d) => {
    d.global.baseFontSizePx = 12;
    d.global.marginMm = 3;
    d.table.fontSizePx = 12;
    setSectionEnabled(d, 'header_note', false);
    setSectionEnabled(d, 'footer_note_1', false);
  });

  const detailed = tuneDesign(defaultDocumentDesign('receipt', 'thermal80'), (d) => {
    setSectionEnabled(d, 'tax_no', true);
    setColumnEnabled(d, 'tax', true);
  });

  const mini = tuneDesign(defaultDocumentDesign('receipt', 'thermal58'), (d) => {
    d.global.marginMm = 2;
    d.global.baseFontSizePx = 12;
    d.table.fontSizePx = 11;
  });

  const a4 = tuneDesign(defaultDocumentDesign('invoice', 'a4'), (d) => {
    d.global.marginMm = 12;
    d.global.baseFontSizePx = 14;
    d.table.fontSizePx = 13;
    setSectionEnabled(d, 'tax_no', true);
  });

  const bakery = tuneDesign(defaultDocumentDesign('receipt', 'thermal80'), (d) => {
    const idx = d.sections.findIndex((b) => b.type === 'header_note');
    const block: Block = {
      id: 'bi-bakery-note',
      type: 'text',
      enabled: true,
      text: 'BEST BEFORE: see pack date',
      style: { align: 'center', bold: true, uppercase: true },
    };
    d.sections.splice(idx < 0 ? d.sections.length : idx + 1, 0, block);
  });

  const ret = tuneDesign(defaultDocumentDesign('return', 'thermal80'), (d) => {
    d.sections.unshift({ id: 'bi-return-banner', type: 'return_banner', enabled: true });
  });

  return [
    mk('builtin-compact-80', 'Compact 80mm', compact),
    mk('builtin-detailed-80', 'Detailed 80mm (tax)', detailed),
    mk('builtin-mini-58', '58mm Mini', mini),
    mk('builtin-a4-invoice', 'A4 Invoice', a4),
    mk('builtin-bakery', 'Bakery (best-before)', bakery),
    mk('builtin-return-refund', 'Return / Refund', ret),
  ];
}

/**
 * A fresh library: the built-ins are always present, but **no defaults are set**
 * — so an install that never opens the designer keeps the Phase-2 applied design
 * (`receipt_design_json`) driving the printer. A default only wins once the owner
 * explicitly sets one.
 */
export function defaultLibrary(): DocumentLibrary {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    templates: builtinTemplates(),
    documentTypeDefaults: {},
    defaults: {},
    branchDefaults: {},
  };
}

/** @deprecated Use defaultLibrary instead */
export function defaultReceiptLibrary(): ReceiptLibrary {
  return {
    schemaVersion: RECEIPT_LIBRARY_SCHEMA_VERSION,
    templates: builtinTemplates().map(t => ({
      ...t,
      design: t.design as unknown as ReceiptDesign,
    })),
    defaults: {},
    branchDefaults: {},
  };
}

export function findTemplate(lib: DocumentLibrary, id: string | undefined | null): TemplateEntry | undefined {
  if (!id) return undefined;
  return lib.templates.find((t) => t.id === id);
}

/** @deprecated Use findTemplate with DocumentLibrary instead */
export function findReceiptTemplate(lib: ReceiptLibrary, id: string | undefined | null): ReceiptTemplateEntry | undefined {
  if (!id) return undefined;
  return lib.templates.find((t) => t.id === id);
}

/**
 * Resolve which template should drive printing for a document type and paper.
 * Priority: branch default (paper) → global default (paper) → global default (documentType) → undefined.
 */
export function resolveLibraryDefault(
  lib: DocumentLibrary,
  documentType: DocumentType,
  paper: DocumentPaper,
  branchId?: string | number | null
): string | undefined {
  const bid = branchId != null && branchId !== '' ? String(branchId) : null;
  if (bid) {
    const b = lib.branchDefaults?.[bid]?.[paper];
    if (b) return b;
  }
  // Check paper-specific default first (legacy)
  if (lib.defaults?.[paper]) return lib.defaults[paper];
  // Fall back to document-type default
  return lib.documentTypeDefaults?.[documentType];
}

/** @deprecated Use resolveLibraryDefault with DocumentLibrary instead */
export function resolveReceiptLibraryDefault(
  lib: ReceiptLibrary,
  paper: ReceiptPaper,
  branchId?: string | number | null
): string | undefined {
  const bid = branchId != null && branchId !== '' ? String(branchId) : null;
  if (bid) {
    const b = lib.branchDefaults?.[bid]?.[paper];
    if (b) return b;
  }
  return lib.defaults?.[paper];
}

/** Tolerant normaliser: built-ins are canonical, customs are kept, junk dropped. */
export function normalizeLibrary(raw: unknown): DocumentLibrary {
  const lib = defaultLibrary();
  if (!raw || typeof raw !== 'object') return lib;
  const r = raw as Record<string, unknown>;

  const builtinIds = new Set(lib.templates.map((t) => t.id));
  const seen = new Set<string>(builtinIds);
  if (Array.isArray(r.templates)) {
    for (const entry of r.templates as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      // Built-ins always come from builtinTemplates(); never accept a spoofed copy.
      if (!id || seen.has(id) || builtinIds.has(id)) continue;
      seen.add(id);
      lib.templates.push({
        id,
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Custom template',
        design: normalizeDocumentDesign(entry.design),
        builtin: false,
        createdAt: asNum(entry.createdAt, 0) ?? 0,
        updatedAt: asNum(entry.updatedAt, 0) ?? 0,
      });
    }
  }

  const allIds = new Set(lib.templates.map((t) => t.id));
  const papers = new Set<string>(DOCUMENT_PAPERS.map((p) => p.value));
  const docTypes = new Set<string>(Object.keys(DOCUMENT_TYPE_LABELS));

  const defaults: DocumentLibrary['defaults'] = {};
  if (r.defaults && typeof r.defaults === 'object') {
    for (const [k, v] of Object.entries(r.defaults as Record<string, unknown>)) {
      if (papers.has(k) && typeof v === 'string' && allIds.has(v)) defaults[k as DocumentPaper] = v;
    }
  }

  const documentTypeDefaults: DocumentLibrary['documentTypeDefaults'] = {};
  if (r.documentTypeDefaults && typeof r.documentTypeDefaults === 'object') {
    for (const [k, v] of Object.entries(r.documentTypeDefaults as Record<string, unknown>)) {
      if (docTypes.has(k) && typeof v === 'string' && allIds.has(v)) documentTypeDefaults[k as DocumentType] = v;
    }
  }

  const branchDefaults: DocumentLibrary['branchDefaults'] = {};
  if (r.branchDefaults && typeof r.branchDefaults === 'object') {
    for (const [branch, map] of Object.entries(r.branchDefaults as Record<string, unknown>)) {
      if (!branch || !map || typeof map !== 'object') continue;
      const inner: Partial<Record<DocumentPaper, string>> = {};
      for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
        if (papers.has(k) && typeof v === 'string' && allIds.has(v)) inner[k as DocumentPaper] = v;
      }
      if (Object.keys(inner).length) branchDefaults[branch] = inner;
    }
  }

  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    templates: lib.templates,
    documentTypeDefaults,
    defaults,
    branchDefaults,
  };
}

/** @deprecated Use normalizeLibrary instead */
export function normalizeReceiptLibrary(raw: unknown): ReceiptLibrary {
  const lib = defaultReceiptLibrary();
  if (!raw || typeof raw !== 'object') return lib;
  const r = raw as Record<string, unknown>;

  const builtinIds = new Set(lib.templates.map((t) => t.id));
  const seen = new Set<string>(builtinIds);
  if (Array.isArray(r.templates)) {
    for (const entry of r.templates as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (!id || seen.has(id) || builtinIds.has(id)) continue;
      seen.add(id);
      lib.templates.push({
        id,
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Custom template',
        design: normalizeReceiptDesign(entry.design),
        builtin: false,
        createdAt: asNum(entry.createdAt, 0) ?? 0,
        updatedAt: asNum(entry.updatedAt, 0) ?? 0,
      });
    }
  }

  const allIds = new Set(lib.templates.map((t) => t.id));
  const papers = new Set<string>(RECEIPT_PAPERS.map((p) => p.value));

  const defaults: ReceiptLibrary['defaults'] = {};
  if (r.defaults && typeof r.defaults === 'object') {
    for (const [k, v] of Object.entries(r.defaults as Record<string, unknown>)) {
      if (papers.has(k) && typeof v === 'string' && allIds.has(v)) defaults[k as ReceiptPaper] = v;
    }
  }

  const branchDefaults: ReceiptLibrary['branchDefaults'] = {};
  if (r.branchDefaults && typeof r.branchDefaults === 'object') {
    for (const [branch, map] of Object.entries(r.branchDefaults as Record<string, unknown>)) {
      if (!branch || !map || typeof map !== 'object') continue;
      const inner: Partial<Record<ReceiptPaper, string>> = {};
      for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
        if (papers.has(k) && typeof v === 'string' && allIds.has(v)) inner[k as ReceiptPaper] = v;
      }
      if (Object.keys(inner).length) branchDefaults[branch] = inner;
    }
  }

  return {
    schemaVersion: RECEIPT_LIBRARY_SCHEMA_VERSION,
    templates: lib.templates,
    defaults,
    branchDefaults,
  };
}

/** A template's design for a given paper (paper is forced onto the design). */
export function templateDesign(t: TemplateEntry, paper?: DocumentPaper): DocumentDesign {
  const d = cloneDesign(t.design);
  if (paper) d.paper = paper;
  return d;
}

/** @deprecated Use templateDesign instead */
export function templateReceiptDesign(t: ReceiptTemplateEntry, paper?: ReceiptPaper): ReceiptDesign {
  const d = cloneReceiptDesign(t.design);
  if (paper) d.paper = paper;
  return d;
}

// ============================================================================
// Re-export renderDocument from renderDocument.ts
// ============================================================================

export {
  renderDocument,
  type ShopProfile,
  type SaleData,
  type RenderContext,
} from './renderDocument';