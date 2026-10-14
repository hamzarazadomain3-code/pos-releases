import { forwardRef, useEffect, useRef, useState, useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '@shared/types';
import type { LabelTemplate, LabelElement, LabelRunOptions } from './types';
import { resolveLabelContent, effectiveExpiry } from './format';

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
  /** Per-print-run overrides so the preview matches what will print. */
  run?: LabelRunOptions;
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
  run,
  zoom,
  setZoom,
  showRuler,
  setShowRuler,
  previewMode,
  setPreviewMode,
  selectedPreviewProduct,
  setSelectedPreviewProduct,
}, ref) => {
  const innerRef = useRef<HTMLDivElement | null>(null);

  const labelW = sizeSpec.w;
  const labelH = sizeSpec.h;
  const gap = sizeSpec.gap;
  const margins = sizeSpec.margins || { t: 0, r: 0, b: 0, l: 0 };
  const options = activeTemplate.options;

  // Pre-render barcodes for every selected product / barcode element.
  useEffect(() => {
    for (const [id] of selectedProducts) {
      const product = products.find(p => p.id === id);
      if (!product) continue;
      for (const el of activeTemplate.elements) {
        if (el.type !== 'barcode' && el.type !== 'qr') continue;
        const text = product.barcode || product.sku || String(product.id);
        const symbology = el.barcodeOptions?.symbology || 'CODE128';
        const key = `${symbology}|${text}|${el.barcodeOptions?.height || 8}|${el.barcodeOptions?.barWidth || 2}`;
        if (barCache.has(key)) continue;
        try {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          JsBarcode(svg, text, {
            format: symbology as any,
            width: el.barcodeOptions?.barWidth || 2,
            height: (el.barcodeOptions?.height || 8) * 3.78, // mm to px at 96dpi
            displayValue: false,
            margin: 0,
          });
          const svgStr = new XMLSerializer().serializeToString(svg);
          barCache.set(key, 'data:image/svg+xml;base64,' + btoa(svgStr));
        } catch {
          /* unencodable value — leave the cell blank rather than crash the page */
        }
      }
    }
  }, [selectedProducts, activeTemplate.elements, products]);

  // Build the flat list of label cells (one per print copy).
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
  const startPos = Math.max(1, sheetStartPos || 1);
  const totalLabels = cells.reduce((sum, c) => sum + c.qty, 0);
  const rows = Math.max(1, Math.ceil((startPos - 1 + totalLabels) / cols));

  const canvasWidth =
    labelLayout === 'sheet'
      ? 190
      : cols * labelW + (cols - 1) * gap + margins.l + margins.r;
  const canvasHeight = rows * (labelH + gap) + gap + margins.t + margins.b;

  // Apply the auto-shrink pass the printer runs, so a long name shrinks in the
  // preview exactly as it will on paper.
  useEffect(() => {
    const root = innerRef.current;
    if (!root) return;
    const t = window.setTimeout(() => {
      root.querySelectorAll<HTMLElement>('[data-shrink]').forEach((el) => {
        const floor = (parseFloat(el.dataset.minPt || '4') || 4) * 1.3333;
        let size = parseFloat(getComputedStyle(el).fontSize) || 10;
        el.style.fontSize = `${size}px`;
        let guard = 0;
        while (el.scrollWidth > el.clientWidth + 0.5 && size > floor && guard < 240) {
          size -= 0.5;
          el.style.fontSize = `${size}px`;
          guard += 1;
        }
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, [cells, activeTemplate, sizeSpec, run, zoom]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const nextZoom = Math.max(50, Math.min(300, zoom + (e.deltaY > 0 ? -10 : 10)));
      setZoom(nextZoom);
    }
  };

  const renderElement = (el: LabelElement, product: Product, ov: any): React.ReactElement | null => {
    if (!el.visible) return null;
    const st = el.style || {};
    const content = resolveLabelContent(el.content || '', product, {
      shopName,
      qty: selectedProducts.get(product.id) || 1,
      override: ov,
      options,
      run,
    });

    // Hide date lines when the product has no expiry (and the option is on).
    const datesHidden = options?.hideDatesWhenNoExpiry !== false && !effectiveExpiry(product, run);
    const isDateEl =
      el.type === 'mfg' || el.type === 'expiry' ||
      /\{(?:mfg|expiry|date)\b/.test(el.content || '');
    if (datesHidden && isDateEl) return null;

    const autoShrink =
      st.autoShrink === true ||
      (options?.autoShrinkName !== false && /\{name\}/.test(el.content || ''));

    const style: React.CSSProperties = {
      position: 'absolute',
      left: `${el.x}mm`,
      top: `${el.y}mm`,
      width: `${el.w}mm`,
      height: `${el.h}mm`,
      transform: `rotate(${el.rotation}deg)`,
      transformOrigin: 'center center',
      fontFamily: st.fontFamily || 'Segoe UI',
      fontSize: `${st.fontSize || 7}pt`,
      fontWeight: st.bold ? '700' : (st.fontWeight || '400'),
      fontStyle: st.italic ? 'italic' : 'normal',
      textAlign: st.align || 'center',
      color: st.color || '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: st.align === 'left' ? 'flex-start' : st.align === 'right' ? 'flex-end' : 'center',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      pointerEvents: 'none',
    };
    const shrinkProps = autoShrink
      ? { 'data-shrink': '1', 'data-min-pt': String(st.minFontSize ?? 4) }
      : {};

    const text = product.barcode || product.sku || String(product.id);

    if (el.type === 'barcode') {
      const key = `${el.barcodeOptions?.symbology || 'CODE128'}|${text}|${el.barcodeOptions?.height || 8}|${el.barcodeOptions?.barWidth || 2}`;
      return (
        <div style={style}>
          <img
            src={barCache.get(key) || ''}
            alt=""
            style={{ height: `${el.barcodeOptions?.height || 8}mm`, width: 'auto', maxWidth: '100%', display: 'block' }}
          />
          {el.barcodeOptions?.showText && (
            <div style={{ fontFamily: 'Consolas, monospace', fontSize: `${(st.fontSize || 7) * 0.8}pt`, marginTop: '1mm' }}>
              {text}
            </div>
          )}
        </div>
      );
    }
    if (el.type === 'qr') {
      return (
        <div style={{ ...style, border: '1px dashed #999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '6pt' }}>
          QR
        </div>
      );
    }
    if (el.type === 'image') {
      const src = content || (product as { image?: string | null }).image || '';
      if (!src) return null;
      return <img src={src} alt="" style={{ ...style, objectFit: 'contain' }} />;
    }
    if (el.type === 'line') {
      return <div style={{ ...style, borderBottom: '0.2mm solid #000', height: 0 }} />;
    }
    if (el.type === 'rect' || el.type === 'border') {
      return <div style={{ ...style, border: '0.2mm solid #000', borderRadius: '1mm' }} />;
    }
    // text / custom-text / price / expiry / mfg / batch / weight / sku
    return <div style={style} {...shrinkAttrs(autoShrink, st)}>{content}</div>;
  };

  const renderLabel = (product: Product, ov: any, index: number) => (
    <div
      key={index}
      className={`label-cell ${selectedPreviewProduct === product.id ? 'selected' : ''}`}
      style={{
        position: 'relative',
        width: `${labelW}mm`,
        height: `${labelH}mm`,
        border: activeTemplate.options?.border ? '0.2mm solid #000' : '0.2mm solid #bbb',
        borderRadius: '1mm',
        background: '#fff',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
      onClick={() => setSelectedPreviewProduct(product.id)}
    >
      {activeTemplate.elements.map(el => renderElement(el, product, ov))}
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
          <input type="radio" name="preview" value="single" checked={previewMode === 'single'} onChange={() => setPreviewMode('single')} /> Single
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
          <input type="radio" name="preview" value="grid" checked={previewMode === 'grid'} onChange={() => setPreviewMode('grid')} /> Grid
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '12px', color: '#666' }}>{Math.round(canvasWidth)} × {Math.round(canvasHeight)} mm · {cols} across</span>
        <button className="btn btn-sm" onClick={() => setZoom(50)}>50%</button>
        <button className="btn btn-sm" onClick={() => setZoom(100)}>100%</button>
        <button className="btn btn-sm" onClick={() => setZoom(150)}>150%</button>
        <button className="btn btn-sm" onClick={() => setZoom(200)}>200%</button>
      </div>

      <div
        ref={innerRef}
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
            {/* Empty cells so a half-used first row starts at the right column */}
            {startPos > 1 && Array.from({ length: startPos - 1 }).map((_, i) => (
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

/** Data attributes that drive the auto-shrink pass. */
function shrinkAttrs(autoShrink: boolean, st: LabelElement['style']): Record<string, string> {
  return autoShrink ? { 'data-shrink': '1', 'data-min-pt': String(st.minFontSize ?? 4) } : {};
}

PreviewCanvas.displayName = 'PreviewCanvas';
