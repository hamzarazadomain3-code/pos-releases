import { useCallback, useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '@shared/types';
import { LabelTemplate, LabelLayout, ProductOverride, PRESET_SIZES, BUILTIN_TEMPLATES, defaultTemplate, parseSavedTemplates, normalizeTemplate, isKnownTemplateId, resolveSizeSpec } from '@pages/LabelStudio/types';
import { formatMoney } from '@utils/currency';
import { KeyboardInput } from '@components/KeyboardInput';
import { useListKeyboard } from '@hooks/useListKeyboard';
import { useKeyboardScope } from '@hooks/useKeyboardScope';
import { Modal } from '@components/Modal';
import { ProductPickerPanel } from '@pages/LabelStudio/ProductPickerPanel';
import { PreviewCanvas } from '@pages/LabelStudio/PreviewCanvas';
import { PropertiesPanel } from '@pages/LabelStudio/PropertiesPanel';
import { TemplateManager } from '@pages/LabelStudio/TemplateManager';
import { LabelEditorCanvas } from '@pages/LabelStudio/LabelEditorCanvas';

export default function LabelStudio() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Map<number, number>>(new Map());
  const [overrides, setOverrides] = useState<Map<number, ProductOverride>>(new Map());

  // Template state. Saved templates load synchronously from localStorage during
  // the FIRST render via the initializer, so `templates` is never empty-while-
  // pending — and every entry is normalized so patterns like `tpl.size.w` are
  // safe even for old/corrupt JSON.
  const [templates, setTemplates] = useState<LabelTemplate[]>(() => parseSavedTemplates(localStorage.getItem('labelStudio.templates')));
  const [activeTemplateId, setActiveTemplateId] = useState<string>('builtin-retail');
  const [customSize, setCustomSize] = useState({ w: 50, h: 30, gap: 1, margins: { t: 2, r: 2, b: 2, l: 2 } });

  // Layout state
  const [labelLayout, setLabelLayout] = useState<LabelLayout>('roll');
  const [rollCols, setRollCols] = useState(1);
  const [sheetRows, setSheetRows] = useState(4);
  const [sheetCols, setSheetCols] = useState(6);
  const [sheetStartPos, setSheetStartPos] = useState(1);

  // Preview state
  const [zoom, setZoom] = useState(100);
  const [showRuler, setShowRuler] = useState(false);
  const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('grid');
  const [selectedPreviewProduct, setSelectedPreviewProduct] = useState<number | null>(null);

  // UI state
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [quickFilter, setQuickFilter] = useState<'none' | 'lowstock' | 'expiring' | 'nobarcode' | 'recent'>('none');
  const [shopName, setShopName] = useState('');
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  
  // Phase 4: Print settings state
  const [printers, setPrinters] = useState<Array<{name: string; displayName: string; isDefault: boolean}>>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('auto');
  const [xOffset, setXOffset] = useState(0);
  const [yOffset, setYOffset] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [calibSize, setCalibSize] = useState<string>('38x25');
  const [showPrintHistory, setShowPrintHistory] = useState(false);
  const [printHistory, setPrintHistory] = useState<Array<{
    id: number;
    timestamp: string;
    templateName: string;
    template?: LabelTemplate;
    productIds: number[];
    size?: string;
    productCount: number;
    labelCount: number;
    printer: string;
  }>>([]);
  const [showCalibration, setShowCalibration] = useState(false);

  // Refs
  const searchRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);

  // Load data
  useEffect(() => {
    window.api.inventory.list().then(setProducts).catch(e => setNotice(e instanceof Error ? e.message : String(e)));
    window.api.settings.getAll().then(s => setShopName(s['shop_name'] || '')).catch(() => undefined);
    window.api.printing.getPrinterSettings().then(s => {
      // labelPaper is a PAPER SIZE key ("38x25", "58x40", ...), never a template
      // id. Writing it straight into activeTemplateId used to resolve to no
      // template — no builtin is named "58x40" (or even "38x25") — and the page
      // crashed with "Cannot read properties of undefined (reading 'size')" on
      // EVERY open, because the printer fallback always reports '38x25'.
      if (s.labelLayout === 'sheet' || s.labelLayout === 'roll') setLabelLayout(s.labelLayout);
      if (s.labelPrinter) setSelectedPrinter(s.labelPrinter || 'auto');
      // FIRST-RUN convenience only: if the owner has never picked a template,
      // start on the built-in whose size matches the configured label paper.
      // If a template was chosen before (`labelStudio.lastUsed`), never override
      // it — that would undo the owner's selection on every reopen.
      if (s.labelPaper && typeof s.labelPaper === 'string' && s.labelPaper in PRESET_SIZES) {
        let hasLast = false;
        try { hasLast = !!localStorage.getItem('labelStudio.lastUsed'); } catch { /* ignore */ }
        if (!hasLast) {
          const bySize = BUILTIN_TEMPLATES.find(t => typeof t.size === 'string' && t.size === s.labelPaper);
          if (bySize) setActiveTemplateId(bySize.id);
        }
      }
    }).catch(() => undefined);
    window.api.printing.getPrinters().then(list =>
      setPrinters((list || []).filter(p => !p.isVirtual))
    ).catch(() => undefined);

    // Restore the last-used template only when it still exists. A stale id
    // (deleted custom template, older build) must NOT be re-applied — the
    // resolution below would otherwise leave `activeTemplate` undefined.
    try {
      const last = localStorage.getItem('labelStudio.lastUsed');
      if (last) {
        const parsed = JSON.parse(last);
        const id = parsed && typeof parsed.templateId === 'string' ? parsed.templateId : null;
        if (id) {
          if (isKnownTemplateId(id, templates)) setActiveTemplateId(id);
          else setNotice(`Saved template "${id}" was not found — using the default Retail template.`);
        }
      }
    } catch {}
  }, []);

  // Save templates
  useEffect(() => {
    if (templates.length) localStorage.setItem('labelStudio.templates', JSON.stringify(templates));
  }, [templates]);

  // Save last used
  useEffect(() => {
    localStorage.setItem('labelStudio.lastUsed', JSON.stringify({ templateId: activeTemplateId }));
  }, [activeTemplateId]);

  // `activeTemplate` must NEVER be undefined: the page reads `.size` and
  // `.defaults` on it in the toolbar, preview, print and export paths. The
  // saved templates, the code-built-ins, and the hard `defaultTemplate()`
  // fallback make every resolution safe, so `activeTemplate.size` and the
  // `sizeSpec` lookups cannot throw "reading 'size'" again.
  const activeTemplate: LabelTemplate =
    templates.find(t => t.id === activeTemplateId) ||
    BUILTIN_TEMPLATES.find(t => t.id === activeTemplateId) ||
    defaultTemplate();
  const sizeSpec = activeTemplate.size === 'custom'
    ? { w: customSize.w || 38, h: customSize.h || 25, gap: customSize.gap ?? 1, margins: customSize.margins }
    : resolveSizeSpec(activeTemplate);

  const barcodeText = (p: Product) => p.sku || p.barcode || String(p.id);

  const fmtExpiry = (d?: string | null): string => {
    if (!d) return '';
    const parts = d.slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
  };

  const todayStr = () => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  // Product filtering
  const filtered = products.filter(p => {
    if (search.trim() && !p.name.toLowerCase().includes(search.trim().toLowerCase()) &&
        !(p.sku ?? '').toLowerCase().includes(search.trim().toLowerCase()) &&
        !(p.barcode ?? '').includes(search.trim())) return false;
    if (categoryFilter !== 'all' && p.category_name !== categoryFilter) return false;
    if (quickFilter === 'lowstock' && (p.stock_qty ?? 0) > (p.low_stock_threshold ?? 5)) return false;
    if (quickFilter === 'expiring' && !p.expiry_date) return false;
    if (quickFilter === 'nobarcode' && (p.barcode || p.sku)) return false;
    if (quickFilter === 'recent' && !p.created_at) return false;
    return true;
  });

  // Keyboard navigation for product list
  const productList = useListKeyboard({
    count: filtered.length,
    onOpen: (i) => { const p = filtered[i]; if (p) toggleProduct(p.id); },
  });

  useKeyboardScope({
    kind: 'page',
    label: 'Label Studio',
    actions: {
      search: () => searchRef.current?.focus(),
      print: () => { void handlePrint(); },
      preview: () => { setShowFullPreview(true); },
      templateManager: () => { setShowTemplateManager(true); },
      editor: () => { setShowEditor(true); },
    },
    shortcuts: [
      { action: 'search', label: 'Focus product search' },
      { action: 'print', label: 'Print labels' },
      { action: 'preview', label: 'Full-size preview' },
      { action: 'templateManager', label: 'Template manager' },
      { action: 'editor', label: 'Open label editor' },
      { keys: '↑ / ↓', label: 'Navigate products' },
      { keys: 'Space', label: 'Toggle selection' },
      { keys: 'Enter', label: 'Add highlighted product' },
      { keys: 'Ctrl+A', label: 'Select all visible' },
    ],
  });

  // Selection handlers
  const toggleProduct = (id: number) => {
    setSelectedProducts(prev => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, 1);
      return next;
    });
  };

  const setProductQty = (id: number, qty: number) => {
    setSelectedProducts(prev => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, Math.max(1, Math.min(999, qty)));
      return next;
    });
  };

  const selectAll = () => {
    setSelectedProducts(prev =>
      prev.size === filtered.length ? new Map() : new Map(filtered.map(p => [p.id, 1]))
    );
  };

  const selectPage = () => {
    setSelectedProducts(prev => {
      const next = new Map(prev);
      filtered.forEach(p => next.set(p.id, next.get(p.id) || 1));
      return next;
    });
  };

  const setQtyToStock = () => {
    setSelectedProducts(prev => {
      const next = new Map(prev);
      filtered.forEach(p => {
        if (next.has(p.id)) next.set(p.id, Math.max(1, Math.floor(p.stock_qty || 1)));
      });
      return next;
    });
  };

  const setQtyToPurchase = () => {
    setSelectedProducts(prev => {
      const next = new Map(prev);
      filtered.forEach(p => {
        if (next.has(p.id)) next.set(p.id, Math.max(1, Math.floor((p as any).last_purchase_qty || 1)));
      });
      return next;
    });
  };

  const selectedIds = () => Array.from(selectedProducts.keys());

  // Print / Preview
  const handlePrint = async () => {
    if (selectedProducts.size === 0) return;
    setBusy(true);
    try {
      const productIds = Array.from(selectedProducts.keys());
      const size = typeof activeTemplate.size === 'string' ? activeTemplate.size : undefined;
      const copies = Math.max(1, Math.min(50, activeTemplate.defaults.copies));
      const r = await window.api.printing.printBarcodeBatchWithOptions(productIds, size, copies, {
        printer: selectedPrinter === 'auto' ? undefined : selectedPrinter,
        xOffset,
        yOffset,
        mirror,
        rotation,
        template: activeTemplate,
      });
      if (r.ok) {
        const labelCount = selectedProducts.size * copies;
        addToPrintHistory(productIds, activeTemplate, labelCount, selectedPrinter === 'auto' ? 'System default' : selectedPrinter, size);
        setNotice(`Printed ${labelCount} label(s).`);
      } else setNotice(r.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const handlePreview = async () => {
    if (selectedProducts.size === 0) return;
    setBusy(true);
    try {
      const productIds = Array.from(selectedProducts.keys());
      const size = typeof activeTemplate.size === 'string' ? activeTemplate.size : undefined;
      const copies = Math.max(1, Math.min(50, activeTemplate.defaults.copies));
      await window.api.printing.previewBarcodeBatch(productIds, size, copies);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // Export to PDF
  const exportToPDF = async () => {
    if (selectedProducts.size === 0) return;
    setBusy(true);
    try {
      const productIds = Array.from(selectedProducts.keys());
      const size = typeof activeTemplate.size === 'string' ? activeTemplate.size : undefined;
      const copies = Math.max(1, Math.min(50, activeTemplate.defaults.copies));
      const result = await window.api.printing.exportLabelBatchToPDF(productIds, activeTemplate, size, copies);
      if (!result.ok || !result.data) {
        setNotice(result.message || 'Export failed');
        return;
      }
      const blob = result.data instanceof Blob ? result.data : new Blob([new Uint8Array(result.data)]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `labels-${activeTemplate.name}-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PDF exported successfully.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // Export to PNG
  const exportToPNG = async () => {
    if (selectedProducts.size === 0) return;
    setBusy(true);
    try {
      const productIds = Array.from(selectedProducts.keys());
      const size = typeof activeTemplate.size === 'string' ? activeTemplate.size : undefined;
      const copies = Math.max(1, Math.min(50, activeTemplate.defaults.copies));
      const result = await window.api.printing.exportLabelBatchToPNG(productIds, activeTemplate, size, copies);
      if (!result.ok || !result.data) {
        setNotice(result.message || 'Export failed');
        return;
      }
      const blob = result.data instanceof Blob ? result.data : new Blob([new Uint8Array(result.data)]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `labels-${activeTemplate.name}-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PNG exported successfully.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // Print calibration sheet
  const handleCalibration = async () => {
    setBusy(true);
    try {
      const size = typeof calibSize === 'string' && calibSize ? calibSize : '38x25';
      const r = await window.api.printing.printCalibrationLabel(size);
      if (r.ok) { setNotice('Calibration sheet printed.'); setShowCalibration(false); }
      else setNotice(r.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // Open the calibration modal with the current template's size preselected.
  const openCalibration = () => {
    const cur = typeof activeTemplate.size === 'string' ? activeTemplate.size : '38x25';
    setCalibSize(cur in PRESET_SIZES ? cur : '38x25');
    setPrintSettingsOpen(false);
    setShowCalibration(true);
  };

  // Add to print history (keeps a per-entry template snapshot so reprint
  // reproduces the same design even after the template is edited/deleted).
  const addToPrintHistory = (productIds: number[], template: LabelTemplate, labelCount: number, printer: string, size?: string) => {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      templateName: template.name,
      template: JSON.parse(JSON.stringify(template)),
      productIds,
      size,
      productCount: productIds.length,
      labelCount,
      printer,
    };
    setPrintHistory(prev => {
      const next = [entry, ...prev.slice(0, 49)];
      localStorage.setItem('labelStudio.printHistory', JSON.stringify(next));
      return next;
    });
  };

  const reprintEntry = async (entry: (typeof printHistory)[number]) => {
    if (!entry.productIds || entry.productIds.length === 0) return;
    setBusy(true);
    try {
      const tpl = entry.template || activeTemplate;
      const copiesPer = Math.max(1, Math.round(entry.labelCount / Math.max(1, entry.productCount)));
      const r = await window.api.printing.printBarcodeBatchWithOptions(entry.productIds, entry.size, copiesPer, {
        printer: entry.printer === 'System default' ? undefined : entry.printer,
        xOffset,
        yOffset,
        mirror,
        rotation,
        template: tpl as LabelTemplate,
      });
      if (r.ok) setNotice(`Reprinted ${entry.labelCount} label(s).`);
      else setNotice(r.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const clearPrintHistory = () => {
    setPrintHistory([]);
    localStorage.removeItem('labelStudio.printHistory');
    setShowPrintHistory(false);
  };

  // Load print history
  useEffect(() => {
    try {
      const saved = localStorage.getItem('labelStudio.printHistory');
      if (saved) setPrintHistory(JSON.parse(saved));
    } catch {}
  }, []);

  // Template actions
  const saveTemplate = (name: string) => {
    const newTemplate: LabelTemplate = {
      id: `custom-${Date.now()}`,
      name,
      size: activeTemplate.size,
      layout: activeTemplate.layout,
      rollCols: activeTemplate.rollCols,
      sheetRows: activeTemplate.sheetRows,
      sheetCols: activeTemplate.sheetCols,
      elements: activeTemplate.elements.map(e => ({ ...e, id: `${e.id}-${Date.now()}` })),
      defaults: activeTemplate.defaults,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setTemplates(prev => [...prev, newTemplate]);
    setActiveTemplateId(newTemplate.id);
    setNotice(`Template "${name}" saved.`);
  };

  const deleteTemplate = (id: string) => {
    if (id.startsWith('builtin-')) { setNotice('Cannot delete built-in template.'); return; }
    setTemplates(prev => prev.filter(t => t.id !== id));
    if (activeTemplateId === id) setActiveTemplateId('builtin-retail');
    setNotice('Template deleted.');
  };

  const duplicateTemplate = (id: string) => {
    const src = [...templates, ...BUILTIN_TEMPLATES].find(t => t.id === id);
    if (!src) return;
    const dup: LabelTemplate = {
      ...src,
      id: `custom-${Date.now()}`,
      name: `${src.name} (Copy)`,
      elements: src.elements.map(e => ({ ...e, id: `${e.id}-${Date.now()}` })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setTemplates(prev => [...prev, dup]);
    setActiveTemplateId(dup.id);
    setNotice('Template duplicated.');
  };

  const exportTemplate = (id: string) => {
    const tpl = [...templates, ...BUILTIN_TEMPLATES].find(t => t.id === id);
    if (!tpl) return;
    const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tpl.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        const tpl = normalizeTemplate(parsed);
        if (!tpl) { setNotice('Invalid template file.'); return; }
        tpl.id = `custom-${Date.now()}`;
        tpl.name = `${tpl.name} (Imported)`;
        tpl.createdAt = Date.now();
        tpl.updatedAt = Date.now();
        setTemplates(prev => [...prev, tpl]);
        setActiveTemplateId(tpl.id);
        setNotice('Template imported.');
      } catch {
        setNotice('Invalid template file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="page label-studio">
      <div className="page-header">
        <h1>Label Studio</h1>
        <div className="toolbar">
          <button className="btn" onClick={() => setShowTemplateManager(true)}>Templates</button>
          <button className="btn" onClick={() => setShowEditor(true)}>Edit Label</button>
          <button className="btn" onClick={() => setPrintSettingsOpen(true)}>Printer</button>
          <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
          <button className="btn btn-primary" onClick={handlePrint} disabled={selectedProducts.size === 0 || busy}>
            {busy ? 'Printing…' : `Print ${selectedProducts.size * activeTemplate.defaults.copies} Label${selectedProducts.size * activeTemplate.defaults.copies === 1 ? '' : 's'}`}
          </button>
          <button className="btn" onClick={() => setShowFullPreview(true)} disabled={selectedProducts.size === 0}>
            Full Preview
          </button>
          <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
          <button className="btn" onClick={exportToPDF} disabled={selectedProducts.size === 0 || busy}>
            Export PDF
          </button>
          <button className="btn" onClick={exportToPNG} disabled={selectedProducts.size === 0 || busy}>
            Export PNG
          </button>
          <button className="btn" onClick={() => setShowPrintHistory(true)} disabled={printHistory.length === 0}>
            History
          </button>
        </div>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>{notice}</div>
      )}

      <div className="studio-layout">
        {/* LEFT PANEL - Product Picker */}
        <ProductPickerPanel
          products={products}
          filtered={filtered}
          categories={categories}
          selectedProducts={selectedProducts}
          overrides={overrides}
          search={search}
          setSearch={setSearch}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          quickFilter={quickFilter}
          setQuickFilter={setQuickFilter}
          searchRef={searchRef}
          productList={productList}
          toggleProduct={toggleProduct}
          setProductQty={setProductQty}
          selectAll={selectAll}
          selectPage={selectPage}
          setQtyToStock={setQtyToStock}
          setQtyToPurchase={setQtyToPurchase}
          setOverrides={setOverrides}
        />

        {/* CENTER PANEL - Live Preview Canvas */}
        <PreviewCanvas
          ref={previewCanvasRef}
          products={products}
          selectedProducts={selectedProducts}
          overrides={overrides}
          activeTemplate={activeTemplate}
          sizeSpec={sizeSpec}
          labelLayout={labelLayout}
          rollCols={rollCols}
          sheetRows={sheetRows}
          sheetCols={sheetCols}
          sheetStartPos={sheetStartPos}
          shopName={shopName}
          zoom={zoom}
          setZoom={setZoom}
          showRuler={showRuler}
          setShowRuler={setShowRuler}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          selectedPreviewProduct={selectedPreviewProduct}
          setSelectedPreviewProduct={setSelectedPreviewProduct}
        />

        {/* RIGHT PANEL - Properties */}
        <PropertiesPanel
          activeTemplate={activeTemplate}
          activeTemplateId={activeTemplateId}
          setActiveTemplateId={setActiveTemplateId}
          templates={templates}
          builtinTemplates={BUILTIN_TEMPLATES}
          labelLayout={labelLayout}
          setLabelLayout={setLabelLayout}
          rollCols={rollCols}
          setRollCols={setRollCols}
          sheetRows={sheetRows}
          setSheetRows={setSheetRows}
          sheetCols={sheetCols}
          setSheetCols={setSheetCols}
          sheetStartPos={sheetStartPos}
          setSheetStartPos={setSheetStartPos}
          customSize={customSize}
          setCustomSize={setCustomSize}
          saveTemplate={saveTemplate}
          deleteTemplate={deleteTemplate}
          duplicateTemplate={duplicateTemplate}
          exportTemplate={exportTemplate}
          importTemplate={importTemplate}
          showTemplateManager={showTemplateManager}
          setShowTemplateManager={setShowTemplateManager}
          showEditor={showEditor}
          setShowEditor={setShowEditor}
          printSettingsOpen={printSettingsOpen}
          setPrintSettingsOpen={setPrintSettingsOpen}
        />
      </div>

      {/* Template Manager Modal */}
      {showTemplateManager && (
      <Modal
        onClose={() => setShowTemplateManager(false)}
        title="Template Manager"
        className="modal-wide"
        showClose
      >
        <TemplateManager
          templates={templates}
          builtinTemplates={BUILTIN_TEMPLATES}
          activeTemplateId={activeTemplateId}
          setActiveTemplateId={setActiveTemplateId}
          deleteTemplate={deleteTemplate}
          duplicateTemplate={duplicateTemplate}
          exportTemplate={exportTemplate}
          importTemplate={importTemplate}
        />
      </Modal>
      )}

      {/* Label Editor Modal */}
      {showEditor && (
      <Modal
        onClose={() => setShowEditor(false)}
        title="Label Editor"
        className="modal-full"
        showClose
      >
        <LabelEditorCanvas
          template={activeTemplate}
          sizeSpec={sizeSpec}
          onSave={(elements) => {
            const updated = { ...activeTemplate, elements, updatedAt: Date.now() };
            if (activeTemplateId.startsWith('builtin-')) {
              const custom: LabelTemplate = { ...updated, id: `custom-${Date.now()}`, name: `${activeTemplate.name} (Custom)` };
              setTemplates(prev => [...prev, custom]);
              setActiveTemplateId(custom.id);
            } else {
              setTemplates(prev => prev.map(t => t.id === activeTemplateId ? updated : t));
            }
            setNotice('Template saved.');
            setShowEditor(false);
          }}
        />
      </Modal>
      )}

      {/* Full Preview Modal */}
      {showFullPreview && (
      <Modal
        onClose={() => setShowFullPreview(false)}
        title="Full Preview"
        className="modal-full"
        showClose
      >
        <div style={{ height: '80vh', overflow: 'auto', background: '#f5f5f5', padding: '20px' }}>
          <PreviewCanvas
            products={products}
            selectedProducts={selectedProducts}
            overrides={overrides}
            activeTemplate={activeTemplate}
            sizeSpec={sizeSpec}
            labelLayout={labelLayout}
            rollCols={rollCols}
            sheetRows={sheetRows}
            sheetCols={sheetCols}
            sheetStartPos={sheetStartPos}
            shopName={shopName}
            zoom={100}
            setZoom={() => {}}
            showRuler={false}
            setShowRuler={() => {}}
            previewMode={'grid'}
            setPreviewMode={() => {}}
            selectedPreviewProduct={null}
            setSelectedPreviewProduct={() => {}}
          />
        </div>
      </Modal>
      )}

      {/* Print Settings Modal */}
      {printSettingsOpen && (
      <Modal
        onClose={() => setPrintSettingsOpen(false)}
        title="Printer Settings"
        className="modal-md"
        showClose
      >
        <div style={{ padding: '16px' }}>
          <h4 style={{ margin: '0 0 12px' }}>Label Printer</h4>
          <label className="field" style={{ display: 'block', marginBottom: '12px' }}>
            <span>Printer</span>
            <select className="field-select" style={{ width: '100%' }} value={selectedPrinter} onChange={e => setSelectedPrinter(e.target.value)}>
              <option value="auto">Auto (system default)</option>
              {printers.map(p => <option key={p.name} value={p.name}>{p.displayName} {p.isDefault ? '(default)' : ''}</option>)}
            </select>
          </label>
          <label className="field" style={{ display: 'block', marginBottom: '12px' }}>
            <span>X Offset (mm)</span>
            <KeyboardInput type="text" decimals value={xOffset} onChange={e => setXOffset(parseFloat(e.target.value) || 0)} style={{ width: '80px' }} />
          </label>
          <label className="field" style={{ display: 'block', marginBottom: '12px' }}>
            <span>Y Offset (mm)</span>
            <KeyboardInput type="text" decimals value={yOffset} onChange={e => setYOffset(parseFloat(e.target.value) || 0)} style={{ width: '80px' }} />
          </label>
          <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} /> Mirror
          </label>
          <label className="field" style={{ display: 'block', marginBottom: '12px' }}>
            <span>Rotation</span>
            <select className="field-select" value={rotation} onChange={e => setRotation(parseInt(e.target.value) || 0)} style={{ width: '100%' }}>
              <option value="0">Rotate 0°</option>
              <option value="90">Rotate 90°</option>
              <option value="180">Rotate 180°</option>
            </select>
          </label>
          <button className="btn" style={{ marginTop: '8px' }} onClick={openCalibration}>Print Calibration Sheet</button>
        </div>
      </Modal>
      )}

      {/* Calibration Sheet Modal */}
      {showCalibration && (
      <Modal
        onClose={() => setShowCalibration(false)}
        title="Calibration Sheet"
        className="modal-md"
        showClose
      >
        <div style={{ padding: '16px' }}>
          <p style={{ margin: '0 0 12px', color: '#555', fontSize: '13px' }}>
            Prints one label-sized sheet with a millimetre ruler on its edges. Print it once,
            hold it against the label roll and adjust the X/Y offsets until the arrow heads align
            with the label edges.
          </p>
          <label className="field" style={{ display: 'block', marginBottom: '12px' }}>
            <span>Label size</span>
            <select className="field-select" style={{ width: '100%' }} value={calibSize} onChange={e => setCalibSize(e.target.value)}>
              {Object.entries(PRESET_SIZES).map(([key, spec]) => (
                <option key={key} value={key}>{spec.label}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button className="btn" onClick={() => setShowCalibration(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCalibration} disabled={busy}>
              {busy ? 'Printing…' : 'Print'}
            </button>
          </div>
        </div>
      </Modal>
      )}

      {/* Print History Modal */}
      {showPrintHistory && (
      <Modal
        onClose={() => setShowPrintHistory(false)}
        title="Print History"
        className="modal-md"
        showClose
      >
        <div style={{ padding: '16px' }}>
          {printHistory.length === 0 ? (
            <p style={{ color: '#888', margin: 0 }}>No prints recorded yet.</p>
          ) : (
            <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
              {printHistory.map(entry => (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #eef2f7' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{entry.templateName}</div>
                    <div style={{ color: '#888', fontSize: '12px' }}>
                      {new Date(entry.timestamp).toLocaleString()} · {entry.productCount} product{entry.productCount === 1 ? '' : 's'} · {entry.labelCount} label{entry.labelCount === 1 ? '' : 's'} · {entry.printer}
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={() => reprintEntry(entry)} disabled={busy}>
                    Reprint
                  </button>
                </div>
              ))}
            </div>
          )}
          {printHistory.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button className="btn" onClick={clearPrintHistory}>Clear History</button>
            </div>
          )}
        </div>
      </Modal>
      )}
    </div>
  );
}