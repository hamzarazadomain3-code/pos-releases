import type { Product } from '../../../../shared/types';

export type LabelSize = '38x25' | '38x28' | '40x30' | '50x25' | '50x30' | '58x40' | '60x40' | '100x50' | 'custom';
export type LabelLayout = 'roll' | 'sheet';

export interface LabelElement {
  id: string;
  type: 'text' | 'barcode' | 'qr' | 'image' | 'line' | 'rect' | 'custom-text' | 'price' | 'expiry' | 'mfg' | 'batch' | 'weight' | 'sku' | 'border';
  x: number; y: number; w: number; h: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  style: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    align?: 'left' | 'center' | 'right';
    color?: string;
    fontWeight?: string;
    borderWidth?: number;
    borderColor?: string;
    borderStyle?: 'solid' | 'dashed' | 'dotted' | string;
    currency?: string;
    decimals?: number;
    unit?: string;
    dateFormat?: string;
    batchPrefix?: string;
    skuPrefix?: string;
    /** Shrink the text until it fits one line (between minFontSize and fontSize). */
    autoShrink?: boolean;
    minFontSize?: number;
  };
  content: string; // for text: template string with {placeholders}
  barcodeOptions?: {
    symbology: string;
    height: number;
    barWidth: number;
    showText: boolean;
    quietZone: number;
    validateEan: boolean;
  };
}

export interface LabelTemplateOptions {
  /** Auto-shrink a `{name}` line until it fits on one line. Default true. */
  autoShrinkName?: boolean;
  /** Print the `±` prefix on a loose/variable-weight item. Default true. */
  showApprox?: boolean;
  /** Drop Mfg/Exp lines when the product has no expiry. Default true. */
  hideDatesWhenNoExpiry?: boolean;
  /** Printer head resolution for barcode bars (203 or 300). */
  barcodeDpi?: number;
  /** Draw a cut border around each label. Default false. */
  border?: boolean;
}

export interface LabelTemplate {
  id: string;
  name: string;
  size: LabelSize | { w: number; h: number; gap: number; margins: { t: number; r: number; b: number; l: number } };
  layout: LabelLayout;
  rollCols?: number;
  sheetRows?: number;
  sheetCols?: number;
  /** 1-based column the first label starts at (skip a half-used roll row). */
  startPos?: number;
  elements: LabelElement[];
  defaults: { copies: number; barcodeOnly: boolean };
  options?: LabelTemplateOptions;
  createdAt: number;
  updatedAt: number;
}

export interface ProductOverride {
  name?: string;
  price?: number;
  expiry?: string;
  qty?: number;
}

/** Per-print-run values chosen in the Print Run dialog. */
export interface LabelRunOptions {
  /** Overrides the product mfg date for the whole run. */
  mfgDate?: string | null;
  /** Overrides every product's expiry for the run. */
  expOverride?: string | null;
  /** Which price the `{price}` element prints. */
  priceSource?: 'retail' | 'wholesale' | 'custom';
  /** Price used when priceSource = 'custom'. */
  customPrice?: number | null;
  /** Overrides `{weight}` for the whole run. */
  weight?: string | null;
  /** 1-based column the first label starts at. */
  startCol?: number | null;
  /** Printer head resolution for barcode bars (203 or 300). */
  barcodeDpi?: number | null;
  /** Columns across the roll for this run (overrides the template). */
  rollCols?: number | null;
}

export const PRESET_SIZES: Record<Exclude<LabelSize, 'custom'>, { label: string; w: number; h: number; gap: number }> = {
  '38x25': { label: '38 × 25 mm', w: 38, h: 25, gap: 1 },
  '38x28': { label: '38 × 28 mm (2-across)', w: 38, h: 28, gap: 2 },
  '40x30': { label: '40 × 30 mm', w: 40, h: 30, gap: 1 },
  '50x25': { label: '50 × 25 mm', w: 50, h: 25, gap: 1 },
  '50x30': { label: '50 × 30 mm', w: 50, h: 30, gap: 1 },
  '58x40': { label: '58 × 40 mm', w: 58, h: 40, gap: 1.5 },
  '60x40': { label: '60 × 40 mm', w: 60, h: 40, gap: 1.5 },
  '100x50': { label: '100 × 50 mm', w: 100, h: 50, gap: 2 },
};

export const BUILTIN_TEMPLATES: LabelTemplate[] = [
  {
    id: 'builtin-al-bagdad-38x28',
    name: 'Al Bagdad Grocery (2-across)',
    size: '38x28',
    layout: 'roll',
    rollCols: 2,
    sheetCols: 4,
    startPos: 1,
    options: {
      autoShrinkName: true,
      showApprox: true,
      hideDatesWhenNoExpiry: true,
      barcodeDpi: 203,
      border: false,
    },
    elements: [
      { id: 'shop', type: 'text', x: 1.5, y: 1.2, w: 35, h: 3, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 5.5, bold: true, align: 'center', color: '#000' },
        content: '{shop}' },
      { id: 'name', type: 'text', x: 1.5, y: 4.4, w: 35, h: 3.8, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6.5, bold: true, align: 'center', color: '#000', autoShrink: true, minFontSize: 4 },
        content: '{name} {weight}{unit}' },
      { id: 'barcode', type: 'barcode', x: 2, y: 8.4, w: 34, h: 8.6, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 8.2, barWidth: 2, showText: false, quietZone: 1, validateEan: true } },
      { id: 'barcode-text', type: 'text', x: 1.5, y: 17.2, w: 35, h: 2.4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Consolas,monospace', fontSize: 4.5, bold: false, align: 'left', color: '#000' },
        content: '{barcode}' },
      { id: 'dates', type: 'text', x: 1.5, y: 19.8, w: 35, h: 2.6, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 4.5, bold: true, align: 'center', color: '#000' },
        content: 'Mfg {mfg:d/m/yy}  Exp {expiry:dd/mm/yyyy}' },
      { id: 'price', type: 'price', x: 1.5, y: 22.6, w: 35, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 10, bold: true, fontWeight: '800', align: 'right', color: '#000' },
        content: '{price}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-al-bagdad-50x30',
    name: 'Al Bagdad Grocery (2-across, 50 × 30)',
    size: '50x30',
    layout: 'roll',
    rollCols: 2,
    sheetCols: 3,
    startPos: 1,
    options: {
      autoShrinkName: true,
      showApprox: true,
      hideDatesWhenNoExpiry: true,
      barcodeDpi: 203,
      border: false,
    },
    elements: [
      { id: 'shop', type: 'text', x: 1.5, y: 1.2, w: 47, h: 3.2, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6, bold: true, align: 'center', color: '#000' },
        content: '{shop}' },
      { id: 'name', type: 'text', x: 1.5, y: 4.6, w: 47, h: 4.2, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 7, bold: true, align: 'center', color: '#000', autoShrink: true, minFontSize: 4 },
        content: '{name} {weight}{unit}' },
      { id: 'barcode', type: 'barcode', x: 3, y: 9, w: 44, h: 9.4, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 9, barWidth: 2, showText: false, quietZone: 1, validateEan: true } },
      { id: 'barcode-text', type: 'text', x: 1.5, y: 18.6, w: 47, h: 2.6, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Consolas,monospace', fontSize: 5, bold: false, align: 'left', color: '#000' },
        content: '{barcode}' },
      { id: 'dates', type: 'text', x: 1.5, y: 21.4, w: 47, h: 3, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 5.5, bold: true, align: 'center', color: '#000' },
        content: 'Mfg {mfg:d/m/yy}  Exp {expiry:dd/mm/yyyy}' },
      { id: 'price', type: 'price', x: 1.5, y: 24.4, w: 47, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 12, bold: true, fontWeight: '800', align: 'right', color: '#000' },
        content: '{price}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-retail',
    name: 'Retail Price Tag',
    size: '38x25',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'shop', type: 'text', x: 2, y: 1, w: 34, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 5.5, bold: true, align: 'center', color: '#000' },
        content: '{shop}' },
      { id: 'name', type: 'text', x: 2, y: 5, w: 34, h: 5, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6, bold: true, align: 'center', color: '#000' },
        content: '{name}' },
      { id: 'barcode', type: 'barcode', x: 3, y: 10, w: 32, h: 10, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 8, barWidth: 2, showText: true, quietZone: 1, validateEan: true } },
      { id: 'price', type: 'text', x: 2, y: 20, w: 15, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 7, bold: true, align: 'left', color: '#000' },
        content: '{price}' },
      { id: 'date', type: 'text', x: 20, y: 20, w: 16, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 4.5, bold: false, align: 'right', color: '#333' },
        content: '{date}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-grocery',
    name: 'Grocery with Expiry',
    size: '50x30',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'shop', type: 'text', x: 2, y: 1, w: 46, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6, bold: true, align: 'center', color: '#000' },
        content: '{shop}' },
      { id: 'name', type: 'text', x: 2, y: 5, w: 46, h: 5, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 7, bold: true, align: 'center', color: '#000' },
        content: '{name}' },
      { id: 'barcode', type: 'barcode', x: 4, y: 10, w: 42, h: 12, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 10, barWidth: 2, showText: true, quietZone: 1, validateEan: true } },
      { id: 'price', type: 'text', x: 2, y: 22, w: 20, h: 5, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 8, bold: true, align: 'left', color: '#000' },
        content: '{price}' },
      { id: 'expiry', type: 'text', x: 28, y: 22, w: 20, h: 5, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6, bold: true, align: 'right', color: '#000' },
        content: 'Exp {expiry}' },
      { id: 'date', type: 'text', x: 2, y: 26, w: 46, h: 3, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 5, bold: false, align: 'center', color: '#333' },
        content: '{date}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-bakery',
    name: 'Bakery/Sweets',
    size: '50x30',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'shop', type: 'text', x: 2, y: 1, w: 46, h: 6, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 9, bold: true, align: 'center', color: '#000' },
        content: '{shop}' },
      { id: 'name', type: 'text', x: 2, y: 7, w: 46, h: 5, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 7, bold: true, align: 'center', color: '#000' },
        content: '{name}' },
      { id: 'barcode', type: 'barcode', x: 4, y: 12, w: 42, h: 10, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 8, barWidth: 2, showText: false, quietZone: 1, validateEan: true } },
      { id: 'packed', type: 'text', x: 2, y: 22, w: 22, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 5.5, bold: true, align: 'left', color: '#000' },
        content: 'Packed: {mfg}' },
      { id: 'expiry', type: 'text', x: 26, y: 22, w: 22, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 5.5, bold: true, align: 'right', color: '#000' },
        content: 'Exp: {expiry}' },
      { id: 'price', type: 'text', x: 2, y: 26, w: 46, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6, bold: true, align: 'center', color: '#000' },
        content: '{price}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-shelf',
    name: 'Shelf Label (Big Price)',
    size: '60x40',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'price', type: 'text', x: 3, y: 3, w: 54, h: 18, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 20, bold: true, align: 'center', color: '#000' },
        content: '{price}' },
      { id: 'name', type: 'text', x: 3, y: 22, w: 54, h: 6, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 7, bold: false, align: 'center', color: '#333' },
        content: '{name}' },
      { id: 'barcode', type: 'barcode', x: 5, y: 28, w: 50, h: 10, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 10, barWidth: 2, showText: true, quietZone: 1, validateEan: true } },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-jewellery',
    name: 'Jewellery/Small',
    size: '38x25',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'name', type: 'text', x: 1, y: 1, w: 36, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 4.5, bold: true, align: 'center', color: '#000' },
        content: '{name}' },
      { id: 'barcode', type: 'barcode', x: 2, y: 5, w: 34, h: 12, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 10, barWidth: 1.5, showText: true, quietZone: 1, validateEan: true } },
      { id: 'price', type: 'text', x: 1, y: 18, w: 36, h: 4, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 5.5, bold: true, align: 'center', color: '#000' },
        content: '{price}' },
      { id: 'sku', type: 'text', x: 1, y: 22, w: 36, h: 3, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 4, bold: false, align: 'center', color: '#666' },
        content: 'SKU: {sku}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-minimal',
    name: 'Minimal Barcode Only',
    size: '38x25',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'barcode', type: 'barcode', x: 2, y: 3, w: 34, h: 16, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 14, barWidth: 2, showText: true, quietZone: 1, validateEan: true } },
    ],
    defaults: { copies: 1, barcodeOnly: true },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-pharmacy',
    name: 'Pharmacy (Price + Expiry)',
    size: '50x30',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'name', type: 'text', x: 2, y: 1, w: 46, h: 5, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 7, bold: true, align: 'center', color: '#000' },
        content: '{name}' },
      { id: 'price', type: 'price', x: 2, y: 6, w: 30, h: 8, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 12, bold: true, align: 'center', color: '#000', fontWeight: '700' },
        content: '{price}' },
      { id: 'barcode', type: 'barcode', x: 4, y: 14, w: 42, h: 12, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 10, barWidth: 2, showText: true, quietZone: 1, validateEan: true } },
      { id: 'expiry', type: 'expiry', x: 2, y: 26, w: 40, h: 6, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6, bold: true, align: 'right', color: '#dc2626' },
        content: 'Exp {expiry}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'builtin-produce',
    name: 'Produce (Weight + Price/kg)',
    size: '50x30',
    layout: 'roll',
    rollCols: 1,
    elements: [
      { id: 'name', type: 'text', x: 2, y: 1, w: 46, h: 5, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 7, bold: true, align: 'center', color: '#000' },
        content: '{name}' },
      { id: 'price', type: 'price', x: 2, y: 6, w: 30, h: 8, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 12, bold: true, align: 'center', color: '#000', fontWeight: '700' },
        content: '{price}' },
      { id: 'barcode', type: 'barcode', x: 4, y: 14, w: 42, h: 12, rotation: 0, visible: true, locked: false,
        style: {}, content: '{barcode}',
        barcodeOptions: { symbology: 'CODE128', height: 10, barWidth: 2, showText: true, quietZone: 1, validateEan: true } },
      { id: 'weight', type: 'weight', x: 2, y: 26, w: 30, h: 6, rotation: 0, visible: true, locked: false,
        style: { fontFamily: 'Segoe UI', fontSize: 6, bold: true, align: 'center', color: '#000' },
        content: '{weight} {unit}' },
    ],
    defaults: { copies: 1, barcodeOnly: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export const DEFAULT_TEMPLATE_ID = 'builtin-retail';

export interface ResolvedSizeSpec {
  w: number;
  h: number;
  gap: number;
  margins?: { t: number; r: number; b: number; l: number };
}

/**
 * A template that is guaranteed to exist and be renderable (38 × 25 mm retail
 * tag). `BUILTIN_TEMPLATES` is code-defined, so the only reason the find fails
 * is if someone deletes `builtin-retail` above — the literal fallback keeps the
 * page alive even then.
 */
export function defaultTemplate(): LabelTemplate {
  return (
    BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) || {
      id: DEFAULT_TEMPLATE_ID,
      name: 'Retail Price Tag',
      size: '38x25',
      layout: 'roll',
      rollCols: 1,
      elements: [],
      defaults: { copies: 1, barcodeOnly: false },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  );
}

const ELEMENT_TYPES: LabelElement['type'][] = [
  'text', 'barcode', 'qr', 'image', 'line', 'rect', 'custom-text',
  'price', 'expiry', 'mfg', 'batch', 'weight', 'sku', 'border',
];

const PRESET_KEYS = Object.keys(PRESET_SIZES) as Exclude<LabelSize, 'custom'>[];

function normalizeElement(raw: any): LabelElement {
  const style = raw && raw.style && typeof raw.style === 'object' ? { ...raw.style } : {};
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `el-${Math.random().toString(36).slice(2, 10)}`,
    type: typeof raw?.type === 'string' && ELEMENT_TYPES.includes(raw.type) ? raw.type : 'text',
    x: Number(raw?.x) || 0,
    y: Number(raw?.y) || 0,
    w: Number(raw?.w) > 0 ? raw.w : 10,
    h: Number(raw?.h) > 0 ? raw.h : 5,
    rotation: Number(raw?.rotation) || 0,
    visible: raw?.visible !== false,
    locked: !!raw?.locked,
    style,
    content: typeof raw?.content === 'string' ? raw.content : '',
    barcodeOptions: raw?.barcodeOptions && typeof raw.barcodeOptions === 'object' ? { ...raw.barcodeOptions } : undefined,
  };
}

function normalizeSize(raw: any): LabelTemplate['size'] {
  if (typeof raw === 'string' && (PRESET_KEYS as string[]).includes(raw)) return raw as LabelSize;
  if (raw && typeof raw === 'object' && Number(raw.w) > 0 && Number(raw.h) > 0) {
    const m = raw.margins && typeof raw.margins === 'object' ? raw.margins : {};
    return {
      w: Number(raw.w),
      h: Number(raw.h),
      gap: Number(raw.gap) >= 0 ? Number(raw.gap) : 1,
      margins: {
        t: Number(m.t) || 0,
        r: Number(m.r) || 0,
        b: Number(m.b) || 0,
        l: Number(m.l) || 0,
      },
    };
  }
  // Unknown/legacy size key → guaranteed preset so PRESET_SIZES lookups never
  // return undefined and previews/canvases never read `sizeSpec.w` on undefined.
  return '38x25';
}

/**
 * Turn whatever came out of localStorage (or an imported JSON file) into a
 * fully-shaped LabelTemplate. Unknown/legacy fields are repaired, not trusted.
 * Returns null only when the value has neither a name nor an id to anchor on.
 */
export function normalizeTemplate(raw: unknown): LabelTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' && typeof t.name !== 'string') return null;
  const d = t.defaults && typeof t.defaults === 'object' ? (t.defaults as Record<string, unknown>) : {};
  const copies = Number(d.copies);
  const elements = Array.isArray(t.elements) ? (t.elements as unknown[]).map(normalizeElement) : [];
  return {
    id: typeof t.id === 'string' ? t.id : `custom-${Date.now()}`,
    name: typeof t.name === 'string' ? t.name : 'Untitled template',
    size: normalizeSize(t.size),
    layout: t.layout === 'sheet' ? 'sheet' : 'roll',
    rollCols: typeof t.rollCols === 'number' && t.rollCols >= 1 ? Math.floor(t.rollCols) : 1,
    sheetRows: typeof t.sheetRows === 'number' && t.sheetRows >= 1 ? Math.floor(t.sheetRows) : 4,
    sheetCols: typeof t.sheetCols === 'number' && t.sheetCols >= 1 ? Math.floor(t.sheetCols) : 6,
    startPos: typeof t.startPos === 'number' && t.startPos >= 1 ? Math.floor(t.startPos) : 1,
    elements,
    defaults: {
      copies: copies >= 1 && copies <= 50 ? Math.floor(copies) : 1,
      barcodeOnly: d.barcodeOnly === true,
    },
    options: normalizeOptions(t.options),
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : 0,
  };
}

/** Repair a template's label-wide option flags. */
function normalizeOptions(raw: unknown): LabelTemplateOptions {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const dpi = Number(o.barcodeDpi);
  return {
    autoShrinkName: o.autoShrinkName !== false,
    showApprox: o.showApprox !== false,
    hideDatesWhenNoExpiry: o.hideDatesWhenNoExpiry !== false,
    barcodeDpi: dpi === 300 ? 300 : 203,
    border: o.border === true,
  };
}

/** Read + repair the templates persisted in localStorage. Never throws. */
export function parseSavedTemplates(raw: string | null): LabelTemplate[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeTemplate).filter((t): t is LabelTemplate => !!t);
  } catch {
    return [];
  }
}

/** True when `id` resolves to a saved template or one of the code-built-ins. */
export function isKnownTemplateId(id: string, saved: LabelTemplate[]): boolean {
  return saved.some((t) => t.id === id) || BUILTIN_TEMPLATES.some((t) => t.id === id);
}

/**
 * Coerce a template's `size` to a non-undefined spec. A preset string maps to
 * PRESET_SIZES (falling back to 38×25 for unknown keys); an embedded object is
 * carried through with sane defaults. This is what guarantees the preview/editor
 * canvases can never read `sizeSpec.w` on undefined.
 */
export function resolveSizeSpec(template: Pick<LabelTemplate, 'size'>): ResolvedSizeSpec {
  const size = template.size;
  if (typeof size === 'string') {
    if (size === 'custom') return { ...PRESET_SIZES['38x25'], margins: { t: 2, r: 2, b: 2, l: 2 } };
    return PRESET_SIZES[size as Exclude<LabelSize, 'custom'>] || { ...PRESET_SIZES['38x25'] };
  }
  const m = size.margins;
  return {
    w: Number(size.w) > 0 ? size.w : 38,
    h: Number(size.h) > 0 ? size.h : 25,
    gap: Number(size.gap) >= 0 ? size.gap : 1,
    margins: m ? { t: Number(m.t) || 0, r: Number(m.r) || 0, b: Number(m.b) || 0, l: Number(m.l) || 0 } : undefined,
  };
}