#!/usr/bin/env python3
"""
Apply the Phase 1 + Phase 2.3 changes to receiptDesign.ts
"""

with open(r'E:\antigravty\billing softwere\pos-app\src\shared\receiptDesign.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add DocumentType, DocumentPaper, etc. at the top (after the module docstring)
# Find the line with "export type ReceiptPaper = 'thermal80' | 'thermal58' | 'a4' | 'a5';"
# and replace from there

# First, let's add the new types after the module docstring and before the original ReceiptPaper
# Find the position after the module docstring (after the first export)

# Strategy: Replace the ReceiptPaper export block with our new types

old_receipt_paper = """export type ReceiptPaper = 'thermal80' | 'thermal58' | 'a4' | 'a5';

export const RECEIPT_PAPERS: Array<{ value: ReceiptPaper; label: string; widthMm: number }> = [
  { value: 'thermal80', label: 'Thermal 80mm', widthMm: 80 },
  { value: 'thermal58', label: 'Thermal 58mm', widthMm: 58 },
  { value: 'a4', label: 'A4 Invoice', widthMm: 210 },
  { value: 'a5', label: 'A5 Invoice', widthMm: 148 },
];"""

new_types = """/**
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

export type DocumentPaper = 
  | 'thermal80' | 'thermal58' 
  | 'a4' | 'a5';

export const DOCUMENT_PAPERS: Array<{ value: DocumentPaper; label: string; widthMm: number }> = [
  { value: 'thermal80', label: 'Thermal 80mm', widthMm: 80 },
  { value: 'thermal58', label: 'Thermal 58mm', widthMm: 58 },
  { value: 'a4', label: 'A4 Invoice', widthMm: 210 },
  { value: 'a5', label: 'A5 Invoice', widthMm: 148 },
];

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

/** Built-in sections + custom block types the designer can place. */
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

/** Block types that can be added more than once (custom blocks). */
export const CUSTOM_BLOCK_TYPES: BlockType[] = [
  'text',
  'divider',
  'image',
  'barcode',
  'spacer',
  'two_col',
  'banner',
];

/** Which block types are available for each document type - for custom blocks only */
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

/** Block types that can be added more than once (custom blocks). */
export const CUSTOM_BLOCK_TYPES: BlockType[] = [
  'text',
  'divider',
  'image',
  'barcode',
  'spacer',
  'two_col',
  'banner',
];

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

/** Which block types are available for each document type - for custom blocks only */
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

/** Aliases for backward compatibility */
export type ReceiptBlockType = BlockType;
export const BUILTIN_BLOCK_TYPES = Object.keys(BLOCK_LABELS).filter(k => !CUSTOM_BLOCK_TYPES.includes(k as BlockType)) as BlockType[];
export const RECEIPT_PAPERS = [
  { value: 'thermal80', label: 'Thermal 80mm', widthMm: 80 },
  { value: 'thermal58', label: 'Thermal 58mm', widthMm: 58 },
  { value: 'a4', label: 'A4 Invoice', widthMm: 210 },
  { value: 'a5', label: 'A5 Invoice', widthMm: 148 },
];
export type ReceiptPaper = DocumentPaper;
export const RECEIPT_PAPERS = DOCUMENT_PAPERS;
export type ReceiptPaper = DocumentPaper;
export type ReceiptBlockType = BlockType;
export const RECEIPT_BLOCK_TYPES = BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const CUSTOM_BLOCK_TYPES = CUSTOM_BLOCK_TYPES_FOR_DOCUMENT.receipt;

/** Aliases for backward compatibility */
export type ReceiptDesign = DocumentDesign;
export type ReceiptPaper = DocumentPaper;
export type ReceiptBlockType = BlockType;
export type ReceiptBlock = Block;
export type ReceiptDesign = DocumentDesign;
export const RECEIPT_DESIGN_SCHEMA_VERSION = DESIGN_SCHEMA_VERSION;
export const RECEIPT_PAPERS = DOCUMENT_PAPERS;
export type ReceiptPaper = DocumentPaper;
export type ReceiptBlockType = BlockType;
export const RECEIPT_BLOCK_TYPES = BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const CUSTOM_BLOCK_TYPES = CUSTOM_BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const RECEIPT_TOKENS = TOKENS;
"""

# Now I need to also add the new types before the original ReceiptPaper export
# Let me also add the DEFAULT_TABLE_COLUMN_LABELS, DEFAULT_META_LABELS, MetaLabelKey
# and update GlobalOptions, DocumentDesign, etc.

# This is getting very complex. Let me write the complete new file instead.

import subprocess
subprocess.run(['git', 'restore', 'src/shared/receiptDesign.ts'], cwd=r'E:\antigravty\billing softwere\pos-app')
print('Restored original file. Now I will write a complete new version.')

# Actually, let me just write the complete new file from scratch
# The original file is about 650 lines. I'll write the complete new version.