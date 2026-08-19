import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '../../../shared/types';

type LabelSize = '38x25' | '50x30' | '100x50';

const GRID_COLS: Record<LabelSize, string> = {
  '38x25': 'repeat(8, 38mm)',
  '50x30': 'repeat(6, 50mm)',
  '100x50': 'repeat(3, 100mm)',
};

const LABEL_W: Record<LabelSize, string> = { '38x25': '38mm', '50x30': '50mm', '100x50': '100mm' };
const LABEL_H: Record<LabelSize, string> = { '38x25': '25mm', '50x30': '30mm', '100x50': '50mm' };
const BARCODE_H: Record<LabelSize, number> = { '38x25': 40, '50x30': 50, '100x50': 60 };

export default function BarcodeGenerator() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [labelSize, setLabelSize] = useState<LabelSize>('38x25');
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api.inventory
      .list()
      .then(setProducts)
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, []);

  const barcodeText = (p: Product) => p.sku || p.barcode || String(p.id);

  const renderBarcodes = () => {
    for (const id of selectedProducts) {
      const product = products.find((p) => p.id === id);
      if (!product) continue;
      try {
        JsBarcode(`#barcode-${id}`, barcodeText(product), {
          format: 'CODE128',
          width: 2,
          height: BARCODE_H[labelSize],
          displayValue: false,
          margin: 0,
        });
      } catch (e) {
        console.error(`Barcode error for product ${id}:`, e);
      }
    }
  };

  useEffect(() => {
    renderBarcodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProducts, labelSize, products]);

  const toggleProduct = (id: number) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedProducts((prev) =>
      prev.size === products.length ? new Set() : new Set(products.map((p) => p.id))
    );
  };

  const handlePrint = () => {
    renderBarcodes();
    setTimeout(() => window.print(), 400);
  };

  const filtered = products.filter(
    (p) =>
      !search.trim() ||
      p.name.toLowerCase().includes(search.trim().toLowerCase()) ||
      (p.sku ?? '').toLowerCase().includes(search.trim().toLowerCase()) ||
      (p.barcode ?? '').includes(search.trim())
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Barcode Label Printer</h1>
        <div className="toolbar">
          <select
            value={labelSize}
            onChange={(e) => setLabelSize(e.target.value as LabelSize)}
            className="field-select"
            style={{ padding: '6px' }}
          >
            <option value="38x25">38mm × 25mm (Thermal)</option>
            <option value="50x30">50mm × 30mm</option>
            <option value="100x50">100mm × 50mm (Large)</option>
          </select>
          <button
            className="btn btn-primary"
            onClick={handlePrint}
            disabled={selectedProducts.size === 0}
          >
            Print {selectedProducts.size} Labels
          </button>
          <button className="btn" onClick={selectAll}>
            {selectedProducts.size === products.length && products.length > 0
              ? 'Deselect All'
              : 'Select All'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <input
        className="search-input"
        placeholder="Search products to label…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: '12px' }}
      />

      <div className="result-list">
        {filtered.map((p) => (
          <label
            key={p.id}
            className="result-item"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={selectedProducts.has(p.id)}
              onChange={() => toggleProduct(p.id)}
              style={{ width: '18px', height: '18px' }}
            />
            <span className="result-name">{p.name}</span>
            <span className="result-meta">
              Rs {p.sale_price.toFixed(2)}
              {p.barcode ? ` • ${p.barcode}` : p.sku ? ` • ${p.sku}` : ' • no barcode'}
              {p.stock_qty > 0 ? ` • ${p.stock_qty} in stock` : ' • out of stock'}
            </span>
          </label>
        ))}
        {filtered.length === 0 && <div className="muted center pad">No products found</div>}
      </div>

      {/* Print area — hidden on screen, visible only in the print output */}
      <div ref={printAreaRef} id="barcode-sheet" style={{ display: 'none', padding: '5mm' }}>
        {selectedProducts.size > 0 && (
          <div
            className="barcode-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: GRID_COLS[labelSize],
              gap: '2mm',
              justifyContent: 'start',
            }}
          >
            {products
              .filter((p) => selectedProducts.has(p.id))
              .map((p) => (
                <div
                  key={p.id}
                  style={{
                    width: LABEL_W[labelSize],
                    height: LABEL_H[labelSize],
                    border: '1px solid #ccc',
                    padding: '2mm',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    textAlign: 'center',
                    fontSize: labelSize === '38x25' ? '7pt' : '9pt',
                    fontFamily: 'Arial, sans-serif',
                    pageBreakInside: 'avoid',
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '1mm', overflow: 'hidden' }}>
                    {p.name.substring(0, 15)}
                  </div>
                  <svg
                    id={`barcode-${p.id}`}
                    style={{
                      maxHeight: labelSize === '38x25' ? '12mm' : '18mm',
                      maxWidth: '100%',
                      margin: '1mm 0',
                    }}
                  />
                  <div style={{ fontWeight: 'bold', fontSize: labelSize === '38x25' ? '6pt' : '8pt' }}>
                    Rs {p.sale_price.toFixed(2)}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body * { display: none; }
          #barcode-sheet { display: block !important; }
          #barcode-sheet .barcode-grid { display: grid !important; }
          #barcode-sheet .barcode-grid > div { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}