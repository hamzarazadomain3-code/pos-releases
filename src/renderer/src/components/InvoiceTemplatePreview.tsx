import type { CSSProperties } from 'react';
import type { TemplateConfig } from '../../../shared/types';
import { formatDateAdmin } from '../utils/dateUtils';

export interface InvoicePreviewItem {
  name: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface InvoiceTemplatePreviewProps {
  config: TemplateConfig;
  /** Optional overrides so the same component can preview a real template. */
  shopName?: string;
  shopAddress?: string;
  shopPhone?: string;
  invoiceNo?: string;
  date?: string;
  customerName?: string;
  items?: InvoicePreviewItem[];
  total?: number;
  style?: CSSProperties;
}

const SAMPLE_ITEMS: InvoicePreviewItem[] = [
  { name: 'Sample Product', qty: 2, rate: 500, amount: 1000 },
];

/**
 * Renders the same compact invoice preview used by the Invoice Designer.
 *
 * Extracted from the page so the editor and the template list preview share
 * one implementation, and so the persisted `TemplateConfig` toggles actually
 * drive what the owner sees instead of being ignored.
 */
export function InvoiceTemplatePreview({
  config,
  shopName = 'Rokar POS',
  shopAddress = 'Shop Address',
  shopPhone = 'Phone',
  invoiceNo = 'INV-001',
  date = new Date().toISOString(),
  customerName = 'Walk-in Customer',
  items = SAMPLE_ITEMS,
  total,
  style,
}: InvoiceTemplatePreviewProps) {
  const fontSize = config.fontSize || 12;
  const color = config.primaryColor || '#DC3545';
  const itemsTotal = total ?? items.reduce((sum, item) => sum + item.amount, 0);
  const money = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div
      style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: 16,
        fontFamily: 'monospace',
        fontSize,
        background: '#fafafa',
        ...style,
      }}
      data-testid="invoice-template-preview"
    >
      {config.showLogo && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: color,
            marginBottom: 8,
          }}
        />
      )}

      {config.showShopName && (
        <div style={{ color, fontWeight: 'bold', fontSize: fontSize + 4, marginBottom: 8 }}>
          {shopName}
        </div>
      )}

      {(config.showShopAddress || config.showShopPhone) && (
        <div style={{ fontSize: fontSize - 2, color: '#666', marginBottom: 8 }}>
          {[config.showShopAddress ? shopAddress : '', config.showShopPhone ? shopPhone : '']
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '8px 0' }} />

      {config.showInvoiceNo && (
        <div style={{ marginBottom: 4, fontWeight: config.boldInvoiceNo ? 'bold' : 'normal' }}>
          Invoice #: {invoiceNo}
        </div>
      )}
      {config.showDate && <div style={{ marginBottom: 4 }}>Date: {formatDateAdmin(date)}</div>}
      {config.showCustomer && (
        <div style={{ marginBottom: 8 }}>Customer: {customerName}</div>
      )}

      {config.showItemsTable && (
        <table style={{ width: '100%', fontSize: fontSize - 2 }}>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.name}-${index}`}>
                <td>{item.name}</td>
                <td style={{ textAlign: 'right' }}>{item.qty} × {money(item.rate)}</td>
                <td style={{ textAlign: 'right' }}>{money(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {config.showTotals && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '8px 0' }} />
          <div
            style={{
              fontWeight: config.boldGrandTotal || config.boldTotal ? 'bold' : 'normal',
              color,
            }}
          >
            Total: {money(itemsTotal)}
          </div>
        </>
      )}

      {config.showFooter && config.footerText && (
        <div
          style={{
            marginTop: 12,
            fontSize: fontSize - 2,
            color: '#888',
            textAlign: 'center',
          }}
        >
          {config.footerText}
        </div>
      )}
    </div>
  );
}
