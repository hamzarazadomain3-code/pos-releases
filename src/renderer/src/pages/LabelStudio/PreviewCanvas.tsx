import { forwardRef, useEffect, useRef, useState, useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '@shared/types';
import type { LabelTemplate, LabelElement } from './types';
import { formatMoney } from '@utils/currency';

interface Props {
  products: Product[];
  selectedProducts: Map<number, number>;
  overrides: Map<number, { name?: string; price?: number; expiry?: string; qty?: number }>;
  activeTemplate: LabelTemplate;
  sizeSpec: { w: number; h: number; gap: number; margins?: { t: number; r: number; b: number; l: number } };
  labelLayout: 'roll' | 'sheet';
  rollCols: number;
  sheetRows: number;
  sheetCols: number;
  sheetStartPos: number;
  shopName: string;
  zoom: number;
  setZoom: (v: number) => void;
  showRuler: boolean;
  setShowRuler: (v: boolean) => void;
  previewMode: 'single' | 'grid';
  setPreviewMode: (v: 'single' | 'grid') => void;
  selectedPreviewProduct: number | null;
  setSelectedPreviewProduct: (id: number | null) => void;
}

const barCache = new Map<string, string>();

async function barcodeDataUrl(text: string, heightMm: number, symbology: string, barWidth: number): Promise<string> {
  const key = `${symbology}|${text}|${heightMm}|${barWidth}`;
  if (barCache.has(key)) return barCache.get(key)!;
  return new Promise((resolve) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, text, {
      format: symbology as any,
      width: barWidth,
      height: heightMm * 3.78, // mm to px at 96dpi
      displayValue: false,
      margin: 0,
    });
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgStr);
    barCache.set(key, dataUrl);
    resolve(dataUrl);
  });
}

function renderElement(
  el: LabelElement,
  product: Product,
  ov: { name?: string; price?: number; expiry?: string; qty?: number } | undefined,
  shopName: string,
  sizeSpec: { w: number; h: number },
  selectedProducts: Map<number, number>
): React.ReactElement | null {
  if (!el.visible) return null;

  const content = el.content
    .replace(/{name}/g, ov?.name || product.name)
    .replace(/{price}/g, formatMoney(ov?.price ?? product.sale_price))
    .replace(/{sku}/g, product.sku || '')
    .replace(/{barcode}/g, product.barcode || product.sku || String(product.id))
    .replace(/{expiry}/g, ov?.expiry ? (ov.expiry.slice(0,10).split('-').reverse().join('/')) : (product.expiry_date ? product.expiry_date.slice(0,10).split('-').reverse().join('/') : ''))
    .replace(/{mfg}/g, (product as any).mfg_date ? (product as any).mfg_date.slice(0,10).split('-').reverse().join('/') : '')
    .replace(/{batch}/g, (product as any).batch_no || '')
    .replace(/{weight}/g, (product as any).weight ? String((product as any).weight) : '')
    .replace(/{shop}/g, shopName)
    .replace(/{category}/g, product.category_name || '')
    .replace(/{image}/g, (product as { image?: string | null }).image || '')
    .replace(/{date}/g, new Date().toLocaleDateString())
    .replace(/{qty}/g, ov?.qty?.toString() || String(selectedProducts.get(product.id) || 1));

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.w}mm`,
    height: `${el.h}mm`,
    transform: `rotate(${el.rotation}deg)`,
    transformOrigin: 'center center',
    fontFamily: el.style.fontFamily || 'Segoe UI',
    fontSize: `${el.style.fontSize || 7}pt`,
    fontWeight: el.style.bold ? '700' : (el.style.fontWeight || '400'),
    fontStyle: el.style.italic ? 'italic' : 'normal',
    textAlign: el.style.align || 'center',
    color: el.style.color || '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: el.style.align === 'left' ? 'flex-start' : el.style.align === 'right' ? 'flex-end' : 'center',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    pointerEvents: 'none',
  };

  switch (el.type) {
    case 'text':
      return <div style={style}>{content}</div>;
    case 'barcode':
      return (
        <div style={style}>
          <img
            src={barCache.get(`${el.barcodeOptions?.symbology}|${product.barcode || product.sku || product.id}|${el.barcodeOptions?.height}|${el.barcodeOptions?.barWidth}`) || ''}
            alt=""
            style={{ height: `${el.barcodeOptions?.height || 8}mm`, width: 'auto', maxWidth: '100%', display: 'block' }}
          />
          {el.barcodeOptions?.showText && (
            <div style={{ fontFamily: 'Consolas, monospace', fontSize: `${(el.style.fontSize || 7) * 0.8}pt`, marginTop: '1mm' }}>
              {product.barcode || product.sku || String(product.id)}
            </div>
          )}
        </div>
      );
    case 'qr':
      // QR code placeholder - would need qrcode library
      return <div style={{ ...style, border: '1px dashed #999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '6pt' }}>QR: {content}</div>;
    case 'image':
      return <img src={content || '/logo.png'} alt="" style={{ ...style, objectFit: 'contain' }} />;
    case 'line':
      return <div style={{ ...style, borderBottom: '0.2mm solid #000', height: 0 }} />;
    case 'rect':
      return <div style={{ ...style, border: '0.2mm solid #000', borderRadius: '1mm' }} />;
    default:
      return null;
  }
}

export const PreviewCanvas = forwardRef<HTMLDivElement, Props>(({
  products,
  selectedProducts,
  overrides,
  activeTemplate,
  sizeSpec,
  labelLayout,
  rollCols,
  sheetRows,
  sheetCols,
  sheetStartPos,
  shopName,
  zoom,
  setZoom,
  showRuler,
  setShowRuler,
  previewMode,
  setPreviewMode,
  selectedPreviewProduct,
  setSelectedPreviewProduct,
}, ref) => {
  const [renderedLabels, setRenderedLabels] = useState<Map<number, string>>(new Map());

  const labelW = sizeSpec.w;
  const labelH = sizeSpec.h;
  const gap = sizeSpec.gap;
  const margins = sizeSpec.margins || { t: 0, r: 0, b: 0, l: 0 };

  // Pre-render barcodes
  useEffect(() => {
    const renderBarcodes = async () => {
      const newCache = new Map<string, string>();
      for (const [id, qty] of selectedProducts) {
        const product = products.find(p => p.id === id);
        if (!product) continue;
        for (const el of activeTemplate.elements) {
          if (el.type === 'barcode' || el.type === 'qr') {
            const text = product.barcode || product.sku || String(product.id);
            const key = `${el.barcodeOptions?.symbology || 'CODE128'}|${text}|${el.barcodeOptions?.height || 8}|${el.barcodeOptions?.barWidth || 2}`;
            if (!barCache.has(key)) {
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              JsBarcode(svg, text, {
                format: (el.barcodeOptions?.symbology || 'CODE128') as any,
                width: el.barcodeOptions?.barWidth || 2,
                height: (el.barcodeOptions?.height || 8) * 3.78,
                displayValue: false,
                margin: 0,
              });
              const serializer = new XMLSerializer();
              const svgStr = serializer.serializeToString(svg);
              const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgStr);
              newCache.set(key, dataUrl);
            }
          }
        }
      }
      newCache.forEach((v, k) => barCache.set(k, v));
    };
    renderBarcodes();
  }, [selectedProducts, activeTemplate.elements, products]);

  // Build flat list of label cells
  const cells = useMemo(() => {
    const result: Array<{ product: Product; qty: number; override: any }> = [];
    for (const [id, qty] of selectedProducts) {
      const product = products.find(p => p.id === id);
      if (!product) continue;
      result.push({ product, qty, override: overrides.get(id) });
    }
    return result;
  }, [products, selectedProducts, overrides]);

  const cols = labelLayout === 'sheet' ? sheetCols : rollCols;
  const totalLabels = cells.reduce((sum, c) => sum + c.qty, 0);
  const rows = Math.max(1, Math.ceil((sheetStartPos - 1 + totalLabels) / cols));

  const canvasWidth = labelLayout === 'sheet' ? 190 : labelW;
  const canvasHeight = rows * (labelH + gap) + gap + margins.t + margins.b;

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const nextZoom = Math.max(50, Math.min(300, zoom + (e.deltaY > 0 ? -10 : 10)));
      setZoom(nextZoom);
    }
  };

  const renderLabel = (product: Product, ov: any, index: number) => (
    <div
      key={index}
      className={`label-cell ${selectedPreviewProduct === product.id ? 'selected' : ''}`}
      style={{
        position: 'relative',
        width: `${labelW}mm`,
        height: `${labelH}mm`,
        border: '0.2mm solid #bbb',
        borderRadius: '1mm',
        background: '#fff',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
      onClick={() => setSelectedPreviewProduct(product.id)}
    >
      {activeTemplate.elements.map(el => renderElement(el, product, ov, shopName, sizeSpec, selectedProducts))}
      {showRuler && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1mm', background: 'repeating-linear-gradient(90deg, #000, #000 1mm, transparent 1mm, transparent 2mm)', pointerEvents: 'none', opacity: 0.3 }} />
          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '1mm', background: 'repeating-linear-gradient(0deg, #000, #000 1mm, transparent 1mm, transparent 2mm)', pointerEvents: 'none', opacity: 0.3 }} />
        </>
      )}
    </div>
  );

  return (
    <div
      ref={ref}
      className="preview-canvas"
      onWheel={handleWheel}
      style={{ padding: '20px', background: '#e8e8e8', borderRadius: '8px', overflow: 'auto', height: 'calc(100vh - 220px)', minHeight: '400px' }}
    >
      <div className="preview-toolbar" style={{ position: 'sticky', top: 0, background: '#fff', padding: '8px', borderRadius: '8px 8px 0 0', margin: '-20px -20px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
          <input type="checkbox" checked={showRuler} onChange={e => setShowRuler(e.target.checked)} /> Show Ruler
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
          <input type="radio" name="preview" value="single" checked={previewMode === 'single'} onChange={e => setPreviewMode('single')} /> Single
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
          <input type="radio" name="preview" value="grid" checked={previewMode === 'grid'} onChange={e => setPreviewMode('grid')} /> Grid
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '12px', color: '#666' }}>{Math.round(canvasWidth)} × {Math.round(canvasHeight)} mm</span>
        <button className="btn btn-sm" onClick={() => setZoom(50)}>50%</button>
        <button className="btn btn-sm" onClick={() => setZoom(100)}>100%</button>
        <button className="btn btn-sm" onClick={() => setZoom(150)}>150%</button>
        <button className="btn btn-sm" onClick={() => setZoom(200)}>200%</button>
      </div>

      <div
        style={{
          transform: `scale(${zoom / 100})`,
          transformOrigin: 'top center',
          width: `${canvasWidth}mm`,
          height: `${canvasHeight}mm`,
          margin: '0 auto',
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          position: 'relative',
        }}
      >
        {previewMode === 'single' && cells.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            {renderLabel(cells[0].product, cells[0].override, 0)}
          </div>
        )}
        {previewMode === 'grid' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, ${labelW}mm)`,
              gap: `${gap}mm`,
              padding: `${margins.t}mm ${margins.r}mm ${margins.b}mm ${margins.l}mm`,
              width: `${canvasWidth}mm`,
            }}
          >
            {/* Empty cells for sheet start position */}
            {labelLayout === 'sheet' && sheetStartPos > 1 && Array.from({ length: sheetStartPos - 1 }).map((_, i) => (
              <div key={`empty-${i}`} style={{ width: `${labelW}mm`, height: `${labelH}mm`, visibility: 'hidden' }} />
            ))}
            {cells.flatMap((cell, ci) =>
              Array.from({ length: cell.qty }).map((_, qi) => renderLabel(cell.product, cell.override, ci * 1000 + qi))
            )}
          </div>
        )}
      </div>

      {cells.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#999' }}>
          Select products from the left panel to preview labels
        </div>
      )}
    </div>
  );
});

PreviewCanvas.displayName = 'PreviewCanvas';