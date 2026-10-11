import type { Product } from '../../../../shared/types';

export type LabelSize = '38x25' | '40x30' | '50x25' | '50x30' | '58x40' | '60x40' | '100x50' | 'custom';
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

export interface LabelTemplate {
  id: string;
  name: string;
  size: LabelSize | { w: number; h: number; gap: number; margins: { t: number; r: number; b: number; l: number } };
  layout: LabelLayout;
  rollCols?: number;
  sheetRows?: number;
  sheetCols?: number;
  elements: LabelElement[];
  defaults: { copies: number; barcodeOnly: boolean };
  createdAt: number;
  updatedAt: number;
}

export interface ProductOverride {
  name?: string;
  price?: number;
  expiry?: string;
  qty?: number;
}

export const PRESET_SIZES: Record<Exclude<LabelSize, 'custom'>, { label: string; w: number; h: number; gap: number }> = {
  '38x25': { label: '38 × 25 mm', w: 38, h: 25, gap: 1 },
  '40x30': { label: '40 × 30 mm', w: 40, h: 30, gap: 1 },
  '50x25': { label: '50 × 25 mm', w: 50, h: 25, gap: 1 },
  '50x30': { label: '50 × 30 mm', w: 50, h: 30, gap: 1 },
  '58x40': { label: '58 × 40 mm', w: 58, h: 40, gap: 1.5 },
  '60x40': { label: '60 × 40 mm', w: 60, h: 40, gap: 1.5 },
  '100x50': { label: '100 × 50 mm', w: 100, h: 50, gap: 2 },
};

export const BUILTIN_TEMPLATES: LabelTemplate[] = [
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