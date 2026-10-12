import { useState, useEffect, useMemo } from 'react';
import { KeyboardInput } from '@components/KeyboardInput';
import { Modal } from '@components/Modal';
import type { LabelTemplate, LabelElement } from './types';

interface Props {
  activeTemplate: LabelTemplate;
  activeTemplateId: string;
  setActiveTemplateId: (id: string) => void;
  templates: LabelTemplate[];
  builtinTemplates: LabelTemplate[];
  labelLayout: 'roll' | 'sheet';
  setLabelLayout: (v: 'roll' | 'sheet') => void;
  rollCols: number;
  setRollCols: (v: number) => void;
  sheetRows: number;
  setSheetRows: (v: number) => void;
  sheetCols: number;
  setSheetCols: (v: number) => void;
  sheetStartPos: number;
  setSheetStartPos: (v: number) => void;
  customSize: { w: number; h: number; gap: number; margins: { t: number; r: number; b: number; l: number } };
  setCustomSize: (v: any) => void;
  saveTemplate: (name: string) => void;
  deleteTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => void;
  exportTemplate: (id: string) => void;
  importTemplate: (file: File) => void;
  showTemplateManager: boolean;
  setShowTemplateManager: (v: boolean) => void;
  showEditor: boolean;
  setShowEditor: (v: boolean) => void;
  printSettingsOpen: boolean;
  setPrintSettingsOpen: (v: boolean) => void;
}

const PRESET_SIZES: Record<string, { label: string; w: number; h: number; gap: number }> = {
  '38x25': { label: '38 × 25 mm', w: 38, h: 25, gap: 1 },
  '40x30': { label: '40 × 30 mm', w: 40, h: 30, gap: 1 },
  '50x25': { label: '50 × 25 mm', w: 50, h: 25, gap: 1 },
  '50x30': { label: '50 × 30 mm', w: 50, h: 30, gap: 1 },
  '58x40': { label: '58 × 40 mm', w: 58, h: 40, gap: 1.5 },
  '60x40': { label: '60 × 40 mm', w: 60, h: 40, gap: 1.5 },
  '100x50': { label: '100 × 50 mm', w: 100, h: 50, gap: 2 },
};

const SYMBOLOGIES = ['CODE128', 'EAN13', 'EAN8', 'UPCA', 'CODE39', 'ITF', 'QR', 'DataMatrix'];
const FONTS = ['Segoe UI', 'Arial', 'Tahoma', 'Noto Nastaliq Urdu', 'Jameel Noori Nastaliq', 'Consolas', 'Courier New'];

export function PropertiesPanel({
  activeTemplate,
  activeTemplateId,
  setActiveTemplateId,
  templates,
  builtinTemplates,
  labelLayout,
  setLabelLayout,
  rollCols,
  setRollCols,
  sheetRows,
  setSheetRows,
  sheetCols,
  setSheetCols,
  sheetStartPos,
  setSheetStartPos,
  customSize,
  setCustomSize,
  saveTemplate,
  deleteTemplate,
  duplicateTemplate,
  exportTemplate,
  importTemplate,
  showTemplateManager,
  setShowTemplateManager,
  showEditor,
  setShowEditor,
  printSettingsOpen,
  setPrintSettingsOpen,
}: Props) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<'template' | 'size' | 'fields' | 'style' | 'barcode'>('template');

  const allTemplates = useMemo(() => [...builtinTemplates, ...templates], [templates]);
  const isCustomSize = activeTemplate.size === 'custom';

  useEffect(() => {
    if (activeTemplate.size !== 'custom') {
      const spec = PRESET_SIZES[activeTemplate.size as keyof typeof PRESET_SIZES];
      if (spec) setCustomSize({ w: spec.w, h: spec.h, gap: spec.gap, margins: { t: 2, r: 2, b: 2, l: 2 } });
    }
  }, [activeTemplate.size]);

  const handleSizeChange = (key: string, value: number) => {
    setCustomSize((prev: typeof customSize) => ({ ...prev, [key]: value }));
    if (!isCustomSize) {
      const updated = { ...activeTemplate, size: { ...customSize, [key]: value } as const };
      if (activeTemplateId.startsWith('builtin-')) {
        saveTemplate(`${activeTemplate.name} (Custom)`);
      }
    }
  };

  const handleTemplateSelect = (id: string) => {
    setActiveTemplateId(id);
    setActiveTab('template');
  };

  const handleSaveAs = () => {
    if (saveName.trim()) {
      saveTemplate(saveName.trim());
      setShowSaveModal(false);
      setSaveName('');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      importTemplate(e.target.files[0]);
      e.target.value = '';
    }
  };

  return (
    <div className="panel properties">
      <div className="panel-header">
        <h3>Properties</h3>
      </div>

      <div className="properties-tabs" style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
        {(['template', 'size', 'fields', 'style', 'barcode'] as const).map(tab => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
            style={{ padding: '6px 12px', border: 'none', background: activeTab === tab ? '#2563eb' : 'transparent', color: activeTab === tab ? '#fff' : '#333', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'template' && (
        <div className="properties-section">
          <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Template</h4>
          <select
            className="field-select"
            value={activeTemplateId}
            onChange={e => handleTemplateSelect(e.target.value)}
            style={{ width: '100%', marginBottom: '12px' }}
          >
            <optgroup label="Built-in">
              {builtinTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
            {templates.length && (
              <optgroup label="Custom">
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            )}
          </select>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => { setSaveName(activeTemplate.name + ' (Copy)'); setShowSaveModal(true); }}>Save As</button>
            <button className="btn btn-sm" onClick={() => duplicateTemplate(activeTemplateId)}>Duplicate</button>
            <button className="btn btn-sm" onClick={() => exportTemplate(activeTemplateId)}>Export JSON</button>
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} id="import-file" ref={el => el && (importFile ? undefined : undefined)} />
            <button className="btn btn-sm" onClick={() => document.getElementById('import-file')?.click()}>Import JSON</button>
            {!activeTemplateId.startsWith('builtin-') && (
              <button className="btn btn-sm btn-danger" onClick={() => deleteTemplate(activeTemplateId)}>Delete</button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'size' && (
        <div className="properties-section">
          <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Label Size</h4>
          <select
            className="field-select"
            value={isCustomSize ? 'custom' : (typeof activeTemplate.size === 'string' ? activeTemplate.size : 'custom')}
            onChange={e => {
              const v = e.target.value;
              if (v === 'custom') {
                const updated = { ...activeTemplate, size: customSize };
                if (activeTemplateId.startsWith('builtin-')) saveTemplate(`${activeTemplate.name} (Custom)`);
              } else {
                const updated = { ...activeTemplate, size: v as any };
                setActiveTemplateId(v);
              }
            }}
            style={{ width: '100%', marginBottom: '12px' }}
          >
            {Object.entries(PRESET_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="custom">Custom Size…</option>
          </select>

          {isCustomSize && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
              <label className="field"><span>Width (mm)</span><KeyboardInput type="text" decimals value={customSize.w} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSizeChange('w', parseFloat(e.target.value) || 0)} /></label>
              <label className="field"><span>Height (mm)</span><KeyboardInput type="text" decimals value={customSize.h} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSizeChange('h', parseFloat(e.target.value) || 0)} /></label>
              <label className="field"><span>Gap (mm)</span><KeyboardInput type="text" decimals value={customSize.gap} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSizeChange('gap', parseFloat(e.target.value) || 0)} /></label>
              <label className="field"><span>Font Base (pt)</span><KeyboardInput type="text" decimals value={activeTemplate.elements[0]?.style?.fontSize || 7} onChange={() => {}} /></label>
              <label className="field"><span>Margin Top (mm)</span><KeyboardInput type="text" decimals value={customSize.margins.t} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomSize((p: typeof customSize) => ({ ...p, margins: { ...p.margins, t: parseFloat(e.target.value) || 0 }}))} /></label>
              <label className="field"><span>Margin Right (mm)</span><KeyboardInput type="text" decimals value={customSize.margins.r} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomSize((p: typeof customSize) => ({ ...p, margins: { ...p.margins, r: parseFloat(e.target.value) || 0 }}))} /></label>
              <label className="field"><span>Margin Bottom (mm)</span><KeyboardInput type="text" decimals value={customSize.margins.b} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomSize((p: typeof customSize) => ({ ...p, margins: { ...p.margins, b: parseFloat(e.target.value) || 0 }}))} /></label>
              <label className="field"><span>Margin Left (mm)</span><KeyboardInput type="text" decimals value={customSize.margins.l} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomSize((p: typeof customSize) => ({ ...p, margins: { ...p.margins, l: parseFloat(e.target.value) || 0 }}))} /></label>
            </div>
          )}
        </div>
      )}

      {activeTab === 'fields' && (
        <div className="properties-section">
          <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Label Fields</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeTemplate.elements.map(el => (
              <label key={el.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', background: '#f8f9fa', borderRadius: '4px' }}>
                <input type="checkbox" checked={el.visible} onChange={e => {}} />
                <span style={{ textTransform: 'capitalize', fontSize: '12px', flex: 1 }}>{el.type === 'text' ? `Text: ${el.content.slice(0,20)}` : el.type.toUpperCase()}</span>
                <button className="btn btn-xs" onClick={() => setShowEditor(true)} style={{ padding: '2px 6px' }}>Edit</button>
              </label>
            ))}
            <button className="btn btn-sm" onClick={() => setShowEditor(true)} style={{ marginTop: '8px' }}>Add Element</button>
          </div>
        </div>
      )}

      {activeTab === 'style' && (
        <div className="properties-section">
          <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Default Styling</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label className="field"><span>Font Family</span>
              <select className="field-select" style={{ width: '100%' }}>
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="field"><span>Font Size (pt)</span><KeyboardInput type="text" decimals value="7" onChange={e => {}} /></label>
            <label className="field"><span>Color</span><input type="color" value="#000000" style={{ width: '100%', height: '32px' }} /></label>
            <label className="field"><span>Alignment</span>
              <select className="field-select" style={{ width: '100%' }}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" /> Bold
            </label>
            <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" /> Italic
            </label>
          </div>
        </div>
      )}

      {activeTab === 'barcode' && (
        <div className="properties-section">
          <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Barcode Defaults</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label className="field"><span>Symbology</span>
              <select className="field-select" style={{ width: '100%' }}>
                {SYMBOLOGIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field"><span>Height (mm)</span><KeyboardInput type="text" decimals value="8" onChange={e => {}} /></label>
            <label className="field"><span>Bar Width</span><KeyboardInput type="text" decimals value="2" onChange={e => {}} /></label>
            <label className="field"><span>Quiet Zone (mm)</span><KeyboardInput type="text" decimals value="1" onChange={e => {}} /></label>
            <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={true} /> Show Human-Readable
            </label>
            <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" /> Auto Validate EAN
            </label>
          </div>
        </div>
      )}

      {/* Layout Section - always visible at bottom */}
      <div className="properties-section" style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Layout</h4>
        <label className="field" style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input type="radio" name="layout" value="roll" checked={labelLayout === 'roll'} onChange={e => setLabelLayout('roll')} /> Roll
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input type="radio" name="layout" value="sheet" checked={labelLayout === 'sheet'} onChange={e => setLabelLayout('sheet')} /> Sheet (A4)
          </label>
        </label>

        {labelLayout === 'roll' && (
          <label className="field"><span>Columns Across Roll</span>
            <select className="field-select" value={rollCols} onChange={e => setRollCols(parseInt(e.target.value))} style={{ width: '80px' }}>
              <option value={1}>1 Across</option>
              <option value={2}>2 Across</option>
              <option value={3}>3 Across</option>
            </select>
          </label>
        )}

        {labelLayout === 'sheet' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label className="field"><span>Sheet Rows</span><KeyboardInput type="text" decimals={false} value={sheetRows} onChange={e => setSheetRows(Math.max(1, parseInt(e.target.value) || 1))} /></label>
            <label className="field"><span>Sheet Cols</span><KeyboardInput type="text" decimals={false} value={sheetCols} onChange={e => setSheetCols(Math.max(1, parseInt(e.target.value) || 1))} /></label>
            <label className="field"><span>Start at Label #</span><KeyboardInput type="text" decimals={false} value={sheetStartPos} onChange={e => setSheetStartPos(Math.max(1, parseInt(e.target.value) || 1))} /></label>
            <label className="field"><span>Labels/Sheet</span><KeyboardInput type="text" decimals={false} value={sheetRows * sheetCols} disabled /></label>
          </div>
        )}
      </div>

      {/* Save As Modal */}
      {showSaveModal && (
      <Modal onClose={() => setShowSaveModal(false)} title="Save Template As" showClose>
        <div style={{ padding: '16px' }}>
          <label className="field" style={{ display: 'block' }}>
            <span>Template Name</span>
            <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} style={{ width: '100%' }} autoFocus />
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveAs}>Save</button>
          </div>
        </div>
      </Modal>
      )}
    </div>
  );
}