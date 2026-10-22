with open(r'E:\antigravty\billing softwere\pos-app\src\shared\receiptDesign.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the last closing brace
last_brace = content.rfind('}')
if last_brace != -1:
    # Add the exports before the last closing brace
    exports = '''\n\n/** Aliases for backward compatibility */
export type ReceiptBlockType = BlockType;
export const BUILTIN_BLOCK_TYPES = Object.keys(BLOCK_LABELS).filter(k => !CUSTOM_BLOCK_TYPES.includes(k as BlockType)) as BlockType[];
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
'''

    new_content = content[:last_brace+1] + '\n\n' + exports + content[last_brace+1:]

    with open(r'E:\antigravty\billing softwere\pos-app\src\shared\receiptDesign.ts', 'w', encoding='utf-8') as f:
        f.write(new_content)

print('Done')