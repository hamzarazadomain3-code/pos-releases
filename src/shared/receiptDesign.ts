/**
 * Receipt Designer — shared design model (Phase 2).
 *
 * A `ReceiptDesign` is the editable description of a thermal receipt: an ordered
 * list of sections (built-in blocks + custom blocks), plus table/global options.
 * It is pure data (JSON-safe) so it can live in `admin_settings`, cross IPC, and
 * be normalised identically in the main process (which renders) and the renderer
 * (which previews/edits).
 *
 * IMPORTANT: this module must stay dependency-free (no `node:` / `electron`), so
 * both processes can import it.
 */

export type ReceiptPaper = 'thermal80' | 'thermal58' | 'a4' | 'a5';

export const RECEIPT_PAPERS: Array<{ value: ReceiptPaper; label: string; widthMm: number }> = [
  { value: 'thermal80', label: 'Thermal 80mm', widthMm: 80 },
  { value: 'thermal58', label: 'Thermal 58mm', widthMm: 58 },
  { value: 'a4', label: 'A4 Invoice', widthMm: 210 },
  { value: 'a5', label: 'A5 Invoice', widthMm: 148 },
];

/** Built-in sections + custom block types the designer can place. */
export type ReceiptBlockType =
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

export const BLOCK_LABELS: Record<ReceiptBlockType, string> = {
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

/** Block types that can be added more than once (custom blocks). */
export const CUSTOM_BLOCK_TYPES: ReceiptBlockType[] = [
  'text',
  'divider',
  'image',
  'barcode',
  'spacer',
  'two_col',
  'banner',
];

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

export interface ReceiptBlock {
  id: string;
  type: ReceiptBlockType;
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

export type TableColumnKey = 'no' | 'name' | 'unit' | 'qty' | 'rate' | 'disc' | 'tax' | 'amt';

export const TABLE_COLUMN_LABELS: Record<TableColumnKey, string> = {
  no: '#',
  name: 'Item',
  unit: 'Unit',
  qty: 'Qty',
  rate: 'Rate',
  disc: 'Disc',
  tax: 'Tax',
  amt: 'Amount',
};

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
}

export interface ReceiptDesign {
  schemaVersion: number;
  paper: ReceiptPaper;
  global: GlobalOptions;
  table: TableOptions;
  sections: ReceiptBlock[];
  /** Per-branch overrides keyed by branch id (string), falling back to default. */
  branchOverrides?: Record<string, Partial<Pick<ReceiptDesign, 'global' | 'table' | 'sections'>>>;
}

export const RECEIPT_DESIGN_SCHEMA_VERSION = 1;

/** Tokens a text/footer block may use; resolved against the sale. */
export const RECEIPT_TOKENS = [
  'shop', 'address', 'phone', 'whatsapp', 'customer', 'cashier',
  'invoice', 'date', 'time', 'total', 'paid', 'balance', 'branch',
  'prev_balance', 'new_balance', 'loyalty_points', 'savings',
  'custom1', 'custom2', 'custom3',
];

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

/** The built-in block order that reproduces the shipped thermal receipt. */
export function defaultSections(): ReceiptBlock[] {
  const built = (type: ReceiptBlockType, enabled = true): ReceiptBlock => ({
    id: `b-${type}`,
    type,
    enabled,
  });
  const dividerIn = (): ReceiptBlock => ({ id: nextId('div'), type: 'divider', enabled: true, variant: 'dashed' });
  return [
    built('logo'),
    built('shop_name'),
    built('address'),
    built('phone_whatsapp'),
    built('tax_no', false),
    built('header_note'),
    built('return_banner'),
    { ...dividerIn(), id: 'b-div-1' },
    built('meta'),
    { ...dividerIn(), id: 'b-div-2' },
    built('items_table'),
    { ...dividerIn(), id: 'b-div-3' },
    built('totals'),
    built('payment'),
    { ...dividerIn(), id: 'b-div-4' },
    // Phase 5: loyalty points + savings before footer
    built('loyalty'),
    built('savings'),
    { ...dividerIn(), id: 'b-div-5' },
    built('footer_note_1'),
    built('footer_note_2'),
    built('software_credit'),
    built('qr', false),
    // Phase 5: return policy + thank you at the very end
    built('return_policy'),
    built('thank_you'),
    built('fbr_qr', false),
  ];
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
  };
}

export function defaultReceiptDesign(paper: ReceiptPaper = 'thermal80'): ReceiptDesign {
  const g = defaultGlobalOptions();
  g.paperWidthMm = RECEIPT_PAPERS.find((p) => p.value === paper)?.widthMm ?? 80;
  return {
    schemaVersion: RECEIPT_DESIGN_SCHEMA_VERSION,
    paper,
    global: g,
    table: defaultTableOptions(),
    sections: defaultSections(),
    branchOverrides: {},
  };
}

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

const TABLECOLS = new Set<string>(Object.keys(TABLE_COLUMN_LABELS));

function normalizeBlock(s: Record<string, unknown>): ReceiptBlock {
  const type = String(s.type) as ReceiptBlockType;
  const b: ReceiptBlock = {
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
    const rs = s.style as Record<string, unknown>;    const st: BlockStyle = {};
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
export function cloneDesign(d: ReceiptDesign): ReceiptDesign {
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

// ── Template library (Phase 3) ────────────────────────────────────────────────

/**
 * A named saved design. `builtin` entries are always re-seeded from
 * `builtinTemplates()` on load, so they can never be lost or corrupted; only
 * custom entries are persisted.
 */
export interface ReceiptTemplateEntry {
  id: string;
  name: string;
  design: ReceiptDesign;
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The whole template store: named templates + default-per-paper (+ per-branch). */
export interface ReceiptLibrary {
  schemaVersion: number;
  templates: ReceiptTemplateEntry[];
  /** Global default template id per paper size (absent ⇒ the Phase-2 applied design). */
  defaults: Partial<Record<ReceiptPaper, string>>;
  /** Per-branch default overrides: branchId → paper → template id. */
  branchDefaults: Record<string, Partial<Record<ReceiptPaper, string>>>;
}

export const RECEIPT_LIBRARY_SCHEMA_VERSION = 1;

export const BUILTIN_TEMPLATE_IDS = [
  'builtin-compact-80',
  'builtin-detailed-80',
  'builtin-mini-58',
  'builtin-a4-invoice',
  'builtin-bakery',
  'builtin-return-refund',
] as const;

function tuneDesign(base: ReceiptDesign, fn: (d: ReceiptDesign) => void): ReceiptDesign {
  const d = cloneDesign(base);
  fn(d);
  return d;
}

function setSectionEnabled(d: ReceiptDesign, type: ReceiptBlockType, on: boolean): void {
  const s = d.sections.find((b) => b.type === type);
  if (s) s.enabled = on;
}

function setColumnEnabled(d: ReceiptDesign, key: TableColumnKey, on: boolean): void {
  const c = d.table.columns.find((x) => x.key === key);
  if (c) c.enabled = on;
}

/** The six shipped starting points. Deterministic (fixed ids, no clock). */
export function builtinTemplates(): ReceiptTemplateEntry[] {
  const mk = (id: string, name: string, design: ReceiptDesign): ReceiptTemplateEntry => ({
    id,
    name,
    design,
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  });

  const compact = tuneDesign(defaultReceiptDesign('thermal80'), (d) => {
    d.global.baseFontSizePx = 12;
    d.global.marginMm = 3;
    d.table.fontSizePx = 12;
    setSectionEnabled(d, 'header_note', false);
    setSectionEnabled(d, 'footer_note_1', false);
  });

  const detailed = tuneDesign(defaultReceiptDesign('thermal80'), (d) => {
    setSectionEnabled(d, 'tax_no', true);
    setColumnEnabled(d, 'tax', true);
  });

  const mini = tuneDesign(defaultReceiptDesign('thermal58'), (d) => {
    d.global.marginMm = 2;
    d.global.baseFontSizePx = 12;
    d.table.fontSizePx = 11;
  });

  const a4 = tuneDesign(defaultReceiptDesign('a4'), (d) => {
    d.global.marginMm = 12;
    d.global.baseFontSizePx = 14;
    d.table.fontSizePx = 13;
    setSectionEnabled(d, 'tax_no', true);
  });

  const bakery = tuneDesign(defaultReceiptDesign('thermal80'), (d) => {
    const idx = d.sections.findIndex((b) => b.type === 'header_note');
    const block: ReceiptBlock = {
      id: 'bi-bakery-note',
      type: 'text',
      enabled: true,
      text: 'BEST BEFORE: see pack date',
      style: { align: 'center', bold: true, uppercase: true },
    };
    d.sections.splice(idx < 0 ? d.sections.length : idx + 1, 0, block);
  });

  const ret = tuneDesign(defaultReceiptDesign('thermal80'), (d) => {
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
export function defaultLibrary(): ReceiptLibrary {
  return {
    schemaVersion: RECEIPT_LIBRARY_SCHEMA_VERSION,
    templates: builtinTemplates(),
    defaults: {},
    branchDefaults: {},
  };
}

export function findTemplate(lib: ReceiptLibrary, id: string | undefined | null): ReceiptTemplateEntry | undefined {
  if (!id) return undefined;
  return lib.templates.find((t) => t.id === id);
}

/**
 * Resolve which template should drive printing for a paper (optionally for a
 * branch). Branch default → global default → undefined (caller falls back to the
 * Phase-2 applied design).
 */
export function resolveLibraryDefault(
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
export function normalizeLibrary(raw: unknown): ReceiptLibrary {
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
export function templateDesign(t: ReceiptTemplateEntry, paper?: ReceiptPaper): ReceiptDesign {
  const d = cloneDesign(t.design);
  if (paper) d.paper = paper;
  return d;
}
