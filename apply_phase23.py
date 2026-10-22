#!/usr/bin/env python3
"""
Apply Phase 2.3 changes to receiptDesign.ts
"""

with open(r'E:\antigravty\billing softwere\pos-app\src\shared\receiptDesign.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add new types and constants at the beginning, after the module docstring
# Find the position right after the module docstring and before the first export

# First, let's add the new types and constants right after the module docstring
# Find the position after the module docstring (after the closing */ of the JSDoc comment)

docstring_end = content.find('*/') + 2
if docstring_end < 2:
    # No docstring found, use position 0
    insert_pos = 0
else:
    # Find the first export after the docstring
    insert_pos = content.find('export type ReceiptPaper', docstring_end)
    if insert_pos == -1:
        insert_pos = docstring_end

# New content to insert at the beginning
new_types = '''\n
/** Document Designer — shared design model (Phase 2.3+).
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
];

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
export const RECEIPT_TOKENS = TOKENS;\n\n'''

# Insert the new content before the first export
new_content = content[:insert_pos] + new_types + content[insert_pos:]

# Now we need to add the new exports at the end of the file
# Add the missing exports that were referenced but not defined

additional_exports = '''

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

/** Tokens a text/footer block may use; resolved against the sale. */
export const TOKENS = [
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

export const DESIGN_SCHEMA_VERSION = 1;

export const RECEIPT_DESIGN_SCHEMA_VERSION = DESIGN_SCHEMA_VERSION;
export const RECEIPT_PAPERS = DOCUMENT_PAPERS;
export type ReceiptPaper = DocumentPaper;
export type ReceiptBlockType = BlockType;
export const RECEIPT_BLOCK_TYPES = BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const CUSTOM_BLOCK_TYPES = CUSTOM_BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const RECEIPT_TOKENS = TOKENS;

// Re-export existing constants and functions that were already in the file
export const RECEIPT_DESIGN_SCHEMA_VERSION = DESIGN_SCHEMA_VERSION;
export const RECEIPT_PAPERS = DOCUMENT_PAPERS;
export type ReceiptPaper = DocumentPaper;
export type ReceiptBlockType = BlockType;
export const RECEIPT_BLOCK_TYPES = BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const CUSTOM_BLOCK_TYPES = CUSTOM_BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const RECEIPT_TOKENS = TOKENS;

// Re-export existing constants and functions that were already in the file
export const RECEIPT_DESIGN_SCHEMA_VERSION = DESIGN_SCHEMA_VERSION;
export const RECEIPT_PAPERS = DOCUMENT_PAPERS;
export type ReceiptPaper = DocumentPaper;
export type ReceiptBlockType = BlockType;
export const RECEIPT_BLOCK_TYPES = BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const CUSTOM_BLOCK_TYPES = CUSTOM_BLOCK_TYPES_FOR_DOCUMENT.receipt;
export const RECEIPT_TOKENS = TOKENS;

// Also need to export the constants and functions that were already exported
// The following are already defined in the original file and should remain exported:
/*
export const RECEIPT_DESIGN_SCHEMA_VERSION = 1;
export const RECEIPT_PAPERS: Array<{ value: ReceiptPaper; label: string; widthMm: number }> = [...];
export function defaultSections(): ReceiptBlock[] { ... }
export function defaultTableOptions(): TableOptions { ... }
export function defaultGlobalOptions(): GlobalOptions { ... }
export function defaultReceiptDesign(paper: ReceiptPaper = 'thermal80'): ReceiptDesign { ... }
export const RECEIPT_DESIGN_SCHEMA_VERSION = 1;
export const RECEIPT_PAPERS = [...];
export function normalizeReceiptDesign(raw: unknown): ReceiptDesign { ... }
export function normalizeLibrary(raw: unknown): ReceiptLibrary { ... }
export function builtinTemplates(): ReceiptTemplateEntry[] { ... }
export function defaultLibrary(): ReceiptLibrary { ... }
export function findTemplate(lib: ReceiptLibrary, id: string | undefined | null): ReceiptTemplateEntry | undefined { ... }
export function normalizeLibrary(raw: unknown): ReceiptLibrary { ... }
export function templateDesign(t: ReceiptTemplateEntry, paper?: ReceiptPaper): ReceiptDesign { ... }
*/

'''

# Append the additional exports
final_content = new_content + additional_exports

with open(r'E:\antigravty\billing softwere\pos-app\src\shared\receiptDesign.ts', 'w', encoding='utf-8') as f:
    f.write(final_content)

print('Applied Phase 2.3 changes to receiptDesign.ts')