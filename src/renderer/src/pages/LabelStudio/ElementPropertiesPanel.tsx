import { LabelElement } from '../LabelStudio/types';
import { formatMoney } from '../../utils/currency';
import { useState } from 'react';

const PLACEHOLDERS = [
  '{name}', '{price}', '{sku}', '{barcode}', '{expiry}', 
  '{mfg}', '{batch}', '{weight}', '{shop}', '{category}', 
  '{date}', '{qty}', '{old_price}', '{sale_price}', '{unit}'
];

interface Props {
  selectedEl: LabelElement | null;
  showElementProps: boolean;
  updateElement: (id: string, updates: Partial<LabelElement>) => void;
  FONTS: string[];
  SYMBOLOGIES: string[];
}

export function ElementPropertiesPanel({
  selectedEl,
  showElementProps,
  updateElement,
  FONTS,
  SYMBOLOGIES,
}: Props) {
  const [showPlaceholderPicker, setShowPlaceholderPicker] = useState(false);

  if (!showElementProps || !selectedEl) return null;

  const handlePlaceholderInsert = (placeholder: string) => {
    updateElement(selectedEl.id, { content: selectedEl.content + placeholder });
    setShowPlaceholderPicker(false);
  };

  return (
    <div style={{ width: '320px', borderLeft: '1px solid #e2e8f0', background: '#fff', padding: '12px', overflow: 'auto' }}>
      <h4 style={{ margin: '0 0 12px', fontSize: '13px' }}>Element Properties</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
        <label className="field"><span>X (mm)</span><input type="text" value={selectedEl.x} onChange={e => updateElement(selectedEl.id, { x: Math.round(parseFloat(e.target.value)) })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
        <label className="field"><span>Y (mm)</span><input type="text" value={selectedEl.y} onChange={e => updateElement(selectedEl.id, { y: Math.round(parseFloat(e.target.value)) })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
        <label className="field"><span>W (mm)</span><input type="text" value={selectedEl.w} onChange={e => updateElement(selectedEl.id, { w: Math.max(1, Math.round(parseFloat(e.target.value))) })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
        <label className="field"><span>H (mm)</span><input type="text" value={selectedEl.h} onChange={e => updateElement(selectedEl.id, { h: Math.max(1, Math.round(parseFloat(e.target.value))) })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
        <label className="field"><span>Rotation</span><input type="text" value={selectedEl.rotation} onChange={e => updateElement(selectedEl.id, { rotation: parseInt(e.target.value) || 0 })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
        <label className="field"><span>Type</span>
          <select className="field-select" value={selectedEl.type} onChange={e => updateElement(selectedEl.id, { type: e.target.value as any })} style={{ width: '100%' }}>
            {['text', 'barcode', 'qr', 'image', 'line', 'rect', 'custom-text', 'price', 'expiry', 'mfg', 'batch', 'weight', 'sku', 'border'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
        <label className="field" style={{ display: 'block', marginBottom: '8px' }}>
          <span>Content / Template</span>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
            <input type="text" value={selectedEl.content} onChange={e => updateElement(selectedEl.id, { content: e.target.value })} style={{ flex: 1, padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} placeholder="{name}, {price}, {barcode}…" />
            <button type="button" className="btn btn-sm" onClick={() => setShowPlaceholderPicker(!showPlaceholderPicker)} style={{ padding: '6px 10px' }}>
              {showPlaceholderPicker ? 'Hide' : 'Insert'} Placeholder
            </button>
          </div>
          {showPlaceholderPicker && (
            <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '120px', overflow: 'auto' }}>
              {PLACEHOLDERS.map(p => (
                <button key={p} type="button" className="btn btn-xs" onClick={() => { updateElement(selectedEl.id, { content: selectedEl.content + p }); }} style={{ fontSize: '11px', padding: '2px 6px' }}>
                  {p}
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>Placeholders: {'{name} {price} {sku} {barcode} {expiry} {mfg} {batch} {weight} {shop} {category} {date} {qty} {unit}'}</div>
        </label>

        {selectedEl.type === 'text' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
            <label className="field"><span>Font</span>
              <select className="field-select" value={selectedEl.style.fontFamily} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, fontFamily: e.target.value } })} style={{ width: '100%' }}>
                {['Segoe UI', 'Arial', 'Tahoma', 'Noto Nastaliq Urdu', 'Jameel Noori Nastaliq', 'Consolas', 'Courier New'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="field"><span>Size (pt)</span><input type="text" value={selectedEl.style.fontSize} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, fontSize: parseFloat(e.target.value) || 7 } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
            <label className="field"><span>Color</span><input type="color" value={selectedEl.style.color} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, color: e.target.value } })} style={{ width: '100%', height: '32px' }} /></label>
            <label className="field"><span>Align</span>
              <select className="field-select" value={selectedEl.style.align} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, align: e.target.value as any } })} style={{ width: '100%' }}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <label><input type="checkbox" checked={selectedEl.style.bold} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, bold: e.target.checked } })} /> Bold</label>
              <label><input type="checkbox" checked={selectedEl.style.italic} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, italic: e.target.checked } })} /> Italic</label>
            </label>
          </div>
        )}

        {selectedEl.type === 'barcode' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
            <label className="field"><span>Symbology</span>
              <select className="field-select" value={selectedEl.barcodeOptions?.symbology} onChange={e => updateElement(selectedEl.id, { barcodeOptions: { ...selectedEl.barcodeOptions!, symbology: e.target.value } })} style={{ width: '100%' }}>
                {['CODE128', 'EAN13', 'EAN8', 'UPCA', 'CODE39', 'ITF', 'QR', 'DataMatrix'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field"><span>Height (mm)</span><input type="text" value={selectedEl.barcodeOptions?.height} onChange={e => updateElement(selectedEl.id, { barcodeOptions: { ...selectedEl.barcodeOptions!, height: parseFloat(e.target.value) || 8 } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
            <label className="field"><span>Bar Width</span><input type="text" value={selectedEl.barcodeOptions?.barWidth} onChange={e => updateElement(selectedEl.id, { barcodeOptions: { ...selectedEl.barcodeOptions!, barWidth: parseFloat(e.target.value) || 2 } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
            <label className="field"><span>Quiet Zone</span><input type="text" value={selectedEl.barcodeOptions?.quietZone} onChange={e => updateElement(selectedEl.id, { barcodeOptions: { ...selectedEl.barcodeOptions!, quietZone: parseFloat(e.target.value) || 1 } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={selectedEl.barcodeOptions?.showText} onChange={e => updateElement(selectedEl.id, { barcodeOptions: { ...selectedEl.barcodeOptions!, showText: e.target.checked } })} /> Show Text
            </label>
            <div style={{ fontSize: '10px', color: selectedEl.barcodeOptions?.symbology === 'EAN13' || selectedEl.barcodeOptions?.symbology === 'EAN8' || selectedEl.barcodeOptions?.symbology === 'UPCA' ? '#dc2626' : '#16a34a' }}>
              {['EAN13', 'EAN8', 'UPCA'].includes(selectedEl.barcodeOptions?.symbology || '') ? '⚠ Validate check digit' : '✓ No validation needed'}
            </div>
          </div>
        )}

        {selectedEl.type === 'image' && (
          <label className="field" style={{ display: 'block', marginTop: '8px' }}>
            <span>Image URL / Path</span>
            <input type="text" value={selectedEl.content} onChange={e => updateElement(selectedEl.id, { content: e.target.value })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} />
          </label>
        )}

        {selectedEl.type === 'price' && (
          <div style={{ marginTop: '8px' }}>
            <label className="field"><span>Price Format</span>
              <select className="field-select" value={selectedEl.style.currency || 'PKR'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, currency: e.target.value } })} style={{ width: '100%' }}>
                <option value="PKR">PKR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="field"><span>Decimals</span>
              <select className="field-select" value={selectedEl.style.decimals || 2} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, decimals: parseInt(e.target.value) } })} style={{ width: '100%' }}>
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
          </div>
        )}

        {selectedEl.type === 'weight' && (
          <div style={{ marginTop: '8px' }}>
            <label className="field"><span>Unit</span>
              <select className="field-select" value={selectedEl.style.unit || 'kg'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, unit: e.target.value } })} style={{ width: '100%' }}>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="lb">lb</option>
                <option value="oz">oz</option>
              </select>
            </label>
          </div>
        )}

        {selectedEl.type === 'border' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
            <label className="field"><span>Border Width</span><input type="text" value={selectedEl.style.borderWidth || 1} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderWidth: parseFloat(e.target.value) || 1 } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
            <label className="field"><span>Border Color</span><input type="color" value={selectedEl.style.borderColor || '#000000'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderColor: e.target.value } })} style={{ width: '100%', height: '32px' }} /></label>
            <label className="field"><span>Border Style</span>
              <select className="field-select" value={selectedEl.style.borderStyle || 'solid'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderStyle: e.target.value as any } })} style={{ width: '100%' }}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>
            <label className="field"><span>Border Color</span><input type="color" value={selectedEl.style.borderColor || '#000000'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderColor: e.target.value } })} style={{ width: '100%', height: '32px' }} /></label>
          </div>
        )}

        {selectedEl.type === 'expiry' && (
          <label className="field" style={{ marginTop: '8px' }}>
            <span>Date Format</span>
            <select className="field-select" value={selectedEl.style.dateFormat || 'DD/MM/YYYY'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, dateFormat: e.target.value } })} style={{ width: '100%' }}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </label>
        )}

        {selectedEl.type === 'mfg' && (
          <label className="field" style={{ marginTop: '8px' }}>
            <span>Date Format</span>
            <select className="field-select" value={selectedEl.style.dateFormat || 'DD/MM/YYYY'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, dateFormat: e.target.value } })} style={{ width: '100%' }}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </label>
        )}

        {selectedEl.type === 'batch' && (
          <label className="field" style={{ marginTop: '8px' }}>
            <span>Prefix</span>
            <input type="text" value={selectedEl.style.batchPrefix || ''} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, batchPrefix: e.target.value } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} placeholder="e.g. BATCH-" />
          </label>
        )}

        {selectedEl.type === 'weight' && (
          <label className="field" style={{ marginTop: '8px' }}>
            <span>Unit</span>
            <select className="field-select" value={selectedEl.style.unit || 'kg'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, unit: e.target.value } })} style={{ width: '100%' }}>
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="lb">lb</option>
              <option value="oz">oz</option>
            </select>
          </label>
        )}

        {selectedEl.type === 'sku' && (
          <label className="field" style={{ marginTop: '8px' }}>
            <span>Prefix</span>
            <input type="text" value={selectedEl.style.skuPrefix || ''} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, skuPrefix: e.target.value } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} placeholder="e.g. SKU-" />
          </label>
        )}

        {selectedEl.type === 'border' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
            <label className="field"><span>Border Width</span><input type="text" value={selectedEl.style.borderWidth || 1} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderWidth: parseFloat(e.target.value) || 1 } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
            <label className="field"><span>Border Color</span><input type="color" value={selectedEl.style.borderColor || '#000000'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderColor: e.target.value } })} style={{ width: '100%', height: '32px' }} /></label>
            <label className="field"><span>Border Style</span>
              <select className="field-select" value={selectedEl.style.borderStyle || 'solid'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderStyle: e.target.value as any } })} style={{ width: '100%' }}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>
            <label className="field"><span>Border Color</span><input type="color" value={selectedEl.style.borderColor || '#000000'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderColor: e.target.value } })} style={{ width: '100%', height: '32px' }} /></label>
          </div>
        )}

        {selectedEl.type === 'image' && (
          <label className="field" style={{ display: 'block', marginTop: '8px' }}>
            <span>Image URL / Path</span>
            <input type="text" value={selectedEl.content} onChange={e => updateElement(selectedEl.id, { content: e.target.value })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} />
          </label>
        )}

        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
          <label className="field" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label className="field"><span>Border Width</span><input type="text" value={selectedEl.style.borderWidth || 1} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderWidth: parseFloat(e.target.value) || 1 } })} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px' }} /></label>
            <label className="field"><span>Border Color</span><input type="color" value={selectedEl.style.borderColor || '#000000'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderColor: e.target.value } })} style={{ width: '100%', height: '32px' }} /></label>
            <label className="field"><span>Border Style</span>
              <select className="field-select" value={selectedEl.style.borderStyle || 'solid'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderStyle: e.target.value as any } })} style={{ width: '100%' }}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>
            <label className="field"><span>Border Color</span><input type="color" value={selectedEl.style.borderColor || '#000000'} onChange={e => updateElement(selectedEl.id, { style: { ...selectedEl.style, borderColor: e.target.value } })} style={{ width: '100%', height: '32px' }} /></label>
          </label>
        </div>
      </div>
    </div>
  );
}