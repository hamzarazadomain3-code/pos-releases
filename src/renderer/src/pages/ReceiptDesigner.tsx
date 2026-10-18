import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import {
  BLOCK_LABELS,
  CUSTOM_BLOCK_TYPES,
  RECEIPT_PAPERS,
  RECEIPT_TOKENS,
  TABLE_COLUMN_LABELS,
  builtinTemplates,
  defaultReceiptDesign,
  findTemplate,
  normalizeLibrary,
  normalizeReceiptDesign,
  templateDesign,
  type ReceiptBlock,
  type ReceiptBlockType,
  type ReceiptDesign,
  type ReceiptLibrary,
  type ReceiptPaper,
  type ReceiptTemplateEntry,
} from '../../../shared/receiptDesign';

/**
 * Settings → Receipt Designer (Phase 2 + 3).
 *
 * Left: the ordered section list (show/hide, reorder, add/remove blocks, select)
 * plus per-block properties, item-table and global options. Right: a live preview
 * produced by the SAME main-process builder the printer uses
 * (`receipt:design:preview` → `buildDesignedReceiptAsync`) with a representative
 * sample sale, so what the owner sees is what prints.
 *
 * Phase 3 adds a template library: named templates (six built-ins + custom),
 * Save / Save As / Rename / Duplicate / Delete / Set default (per paper, per
 * branch) / Reset / Import-Export JSON, Undo/Redo (Ctrl+Z / Ctrl+Y), an autosaved
 * draft, an unsaved-changes prompt, and an owner/admin-only edit gate.
 */

const ACTIVE_KEY = 'receipt_designer_active';
const DRAFT_PREFIX = 'receipt_designer_draft:';
const STYLE_DEFAULTS = { fontSizePx: 13 };

function draftKey(id: string): string {
  return DRAFT_PREFIX + id;
}

function loadDraft(id: string): ReceiptDesign | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    return normalizeReceiptDesign(JSON.parse(raw));
  } catch {
    return null;
  }
}

function clearDraft(id: string): void {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}

function newCustomId(): string {
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Merge an imported library into the current one (incoming customs + defaults). */
function mergeLibraries(base: ReceiptLibrary, incoming: ReceiptLibrary): ReceiptLibrary {
  const templates = base.templates.slice();
  const taken = new Set(templates.map((t) => t.id));
  for (const t of incoming.templates) {
    if (t.builtin) continue;
    if (taken.has(t.id)) {
      // Never overwrite an existing id: give the import a fresh one.
      const id = newCustomId();
      templates.push({ ...t, id, builtin: false });
      taken.add(id);
    } else {
      templates.push({ ...t, builtin: false });
      taken.add(t.id);
    }
  }
  const valid = new Set(templates.map((t) => t.id));
  const remap = (id: string | undefined): string | undefined => (id && valid.has(id) ? id : undefined);
  const defaults: ReceiptLibrary['defaults'] = { ...base.defaults };
  for (const [k, v] of Object.entries(incoming.defaults)) {
    const r = remap(v);
    if (r) defaults[k as ReceiptPaper] = r;
  }
  const branchDefaults: ReceiptLibrary['branchDefaults'] = { ...base.branchDefaults };
  for (const [branch, map] of Object.entries(incoming.branchDefaults)) {
    const merged: Partial<Record<ReceiptPaper, string>> = { ...(branchDefaults[branch] || {}) };
    for (const [k, v] of Object.entries(map)) {
      const r = remap(v);
      if (r) merged[k as ReceiptPaper] = r;
    }
    branchDefaults[branch] = merged;
  }
  return { ...base, templates, defaults, branchDefaults };
}

export default function ReceiptDesigner({ onClose }: { onClose: () => void }) {
  const [library, setLibrary] = useState<ReceiptLibrary>(() => normalizeLibrary(null));
  const [activeId, setActiveId] = useState<string>('');
  const [design, setDesign] = useState<ReceiptDesign>(() => defaultReceiptDesign('thermal80'));
  const [enabled, setEnabled] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [paper, setPaper] = useState<ReceiptPaper>('thermal80');
  const [sample, setSample] = useState<'sale' | 'return'>('sale');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [newBlockType, setNewBlockType] = useState<ReceiptBlockType>('text');
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [defaultScope, setDefaultScope] = useState<string>('');
  const [nameDialog, setNameDialog] = useState<{ mode: 'new' | 'rename'; value: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shopSettings, setShopSettings] = useState<{ name: string; address: string; phone: string; whatsapp: string; taxNo: string } | null>(null);

  const previewTimer = useRef<number | null>(null);
  const designRef = useRef<ReceiptDesign>(design);
  const pastRef = useRef<ReceiptDesign[]>([]);
  const futureRef = useRef<ReceiptDesign[]>([]);
  const [, forceHist] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const activeTemplate = useMemo(() => findTemplate(library, activeId), [library, activeId]);
  const selected = useMemo(
    () => design.sections.find((s) => s.id === selectedId) ?? null,
    [design.sections, selectedId]
  );
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  // ── load ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [libRes, applied, user, settings] = await Promise.all([
          window.api.receipt.getLibrary(),
          window.api.receipt.getDesign(),
          window.api.auth.currentUser().catch(() => null),
          window.api.settings.getAll().catch(() => null),
        ]);
        if (!alive) return;
        const lib = normalizeLibrary(libRes);
        setLibrary(lib);
        setEnabled(!!applied.enabled);
        const role = (user as { role?: string } | null)?.role ?? null;
        setCanEdit(role != null && role !== 'cashier');

        if (settings) {
          setShopSettings({
            name: settings.shop_name || '',
            address: settings.shop_address || '',
            phone: settings.shop_phone || '',
            whatsapp: settings.shop_whatsapp || '',
            taxNo: settings.tax_no || '',
          });
        }

        const remembered = localStorage.getItem(ACTIVE_KEY) || '';
        const chosenId = findTemplate(lib, remembered)?.id || lib.templates[0]?.id || '';
        const t = findTemplate(lib, chosenId);
        if (t) {
          const draft = loadDraft(t.id);
          const chosen = draft ?? templateDesign(t);
          designRef.current = chosen;
          setDesign(chosen);
          setPaper(chosen.paper);
          setActiveId(t.id);
          setDirty(!!draft);
          if (draft) setNotice(`Restored an unsaved draft of “${t.name}” — Save to keep it.`);
        }
      } catch (e) {
        if (alive) setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    window.api.branches
      .list()
      .then((b) => setBranches(Array.isArray(b) ? (b as Array<{ id: number; name: string }>) : []))
      .catch(() => setBranches([]));
    return () => {
      alive = false;
    };
  }, []);

  // ── history ──
  const commit = useCallback((next: ReceiptDesign, record = true) => {
    if (record) {
      pastRef.current = [...pastRef.current, designRef.current].slice(-100);
      futureRef.current = [];
    }
    designRef.current = next;
    setDesign(next);
    setDirty(true);
    forceHist((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (!past.length) return;
    const prev = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [designRef.current, ...futureRef.current].slice(0, 100);
    designRef.current = prev;
    setDesign(prev);
    setDirty(true);
    forceHist((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (!future.length) return;
    const next = future[0];
    futureRef.current = future.slice(1);
    pastRef.current = [...pastRef.current, designRef.current].slice(-100);
    designRef.current = next;
    setDesign(next);
    setDirty(true);
    forceHist((n) => n + 1);
  }, []);

  // ── undo / redo keys (skip while typing so text fields keep native undo) ──
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      const k = (e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        if (typing) return;
        e.preventDefault();
        e.stopPropagation();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        if (typing) return;
        e.preventDefault();
        e.stopPropagation();
        redo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canEdit, undo, redo]);

  // ── autosave draft ──
  useEffect(() => {
    if (loading || !activeId) return;
    const id = activeId;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey(id), JSON.stringify(design));
      } catch {
        /* quota — best effort */
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [design, activeId, loading]);

  // ── live preview (debounced) ──
  useEffect(() => {
    if (loading) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(async () => {
      try {
        const html = await window.api.receipt.previewDesign({ ...design, paper }, paper, sample);
        setPreviewHtml(html);
      } catch (e) {
        setPreviewHtml(
          `<pre style="color:#b91c1c;font:12px monospace">${e instanceof Error ? e.message : String(e)}</pre>`
        );
      }
    }, 250);
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [design, paper, sample, loading]);

  // ── design mutation helpers ──
  const patchDesign = useCallback(
    (patch: Partial<ReceiptDesign>) => commit({ ...designRef.current, ...patch }),
    [commit]
  );

  const updateBlock = useCallback(
    (id: string, patch: Partial<ReceiptBlock>) => {
      const d = designRef.current;
      commit({ ...d, sections: d.sections.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
    },
    [commit]
  );

  const updateStyle = useCallback(
    (id: string, patch: Partial<ReceiptBlock['style']>) => {
      const d = designRef.current;
      commit({
        ...d,
        sections: d.sections.map((b) => (b.id === id ? { ...b, style: { ...(b.style || {}), ...patch } } : b)),
      });
    },
    [commit]
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const d = designRef.current;
      const i = d.sections.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.sections.length) return;
      const next = d.sections.slice();
      const [it] = next.splice(i, 1);
      next.splice(j, 0, it);
      commit({ ...d, sections: next });
    },
    [commit]
  );

  const addBlock = useCallback(() => {
    const id = `c-${Date.now().toString(36)}`;
    const base: ReceiptBlock = { id, type: newBlockType, enabled: true };
    if (newBlockType === 'text') base.text = 'Custom text — tokens like {shop} {invoice} {total}';
    if (newBlockType === 'divider') base.variant = 'dashed';
    if (newBlockType === 'spacer') base.heightMm = 3;
    if (newBlockType === 'two_col') {
      base.label = 'Label';
      base.value = '{total}';
    }
    if (newBlockType === 'barcode') base.value = '{invoice}';
    if (newBlockType === 'banner') base.text = 'Banner text';
    if (newBlockType === 'image') base.src = '';
    const d = designRef.current;
    commit({ ...d, sections: [...d.sections, base] });
    setSelectedId(id);
    setExpandedId(id);
  }, [newBlockType, commit]);

  const removeBlock = useCallback(
    (id: string) => {
      const d = designRef.current;
      commit({ ...d, sections: d.sections.filter((b) => b.id !== id) });
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [commit]
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      const d = designRef.current;
      const block = d.sections.find((b) => b.id === id);
      if (!block) return;
      const newId = `c-${Date.now().toString(36)}`;
      const newBlock = { ...block, id: newId };
      const index = d.sections.findIndex((b) => b.id === id);
      const next = [...d.sections];
      next.splice(index + 1, 0, newBlock);
      commit({ ...d, sections: next });
      setSelectedId(newId);
      setExpandedId(newId);
    },
    [commit]
  );

  // ── template library operations ──
  const persistLibrary = useCallback(
    async (lib: ReceiptLibrary, msg?: string) => {
      setSaving(true);
      setNotice('');
      try {
        const res = await window.api.receipt.setLibrary(lib);
        setLibrary(lib);
        setNotice(res.message || msg || 'Saved');
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const switchTemplate = useCallback(
    (id: string) => {
      const t = findTemplate(library, id);
      if (!t) return;
      if (dirty && canEdit && !window.confirm('Discard unsaved changes to the current template?')) {
        return;
      }
      if (dirty) clearDraft(activeId);
      const chosen = templateDesign(t);
      designRef.current = chosen;
      setDesign(chosen);
      setPaper(chosen.paper);
      setActiveId(t.id);
      setSelectedId(null);
      setDirty(false);
      pastRef.current = [];
      futureRef.current = [];
      forceHist((n) => n + 1);
      try {
        localStorage.setItem(ACTIVE_KEY, t.id);
      } catch {
        /* ignore */
      }
      const draft = loadDraft(t.id);
      if (draft) {
        commit(draft, false);
        setNotice(`Restored an unsaved draft of “${t.name}”.`);
      } else {
        setNotice('');
      }
    },
    [library, dirty, canEdit, activeId, commit]
  );

  const handleSave = useCallback(async () => {
    const t = findTemplate(library, activeId);
    if (!t) return;
    const now = Date.now();
    const saved = { ...design, paper };
    const nextLib: ReceiptLibrary = {
      ...library,
      templates: library.templates.map((x) =>
        x.id === activeId ? { ...x, design: saved, updatedAt: now, createdAt: x.createdAt || now } : x
      ),
    };
    await persistLibrary(nextLib, `“${t.name}” saved`);
    // Keep the phase-2 fallback in sync so an install with no default still
    // prints the most recently saved template when applied.
    try {
      await window.api.receipt.setDesign(saved, undefined);
    } catch {
      /* owner-gated; ignore if not permitted */
    }
    setDirty(false);
    clearDraft(activeId);
  }, [library, activeId, design, paper, persistLibrary]);

  const doSaveAs = useCallback(
    async (name: string) => {
      const now = Date.now();
      const entry: ReceiptTemplateEntry = {
        id: newCustomId(),
        name: name || 'Custom template',
        design: { ...design, paper },
        builtin: false,
        createdAt: now,
        updatedAt: now,
      };
      await persistLibrary({ ...library, templates: [...library.templates, entry] }, `“${entry.name}” created`);
      setActiveId(entry.id);
      setDirty(false);
      pastRef.current = [];
      futureRef.current = [];
      forceHist((n) => n + 1);
      try {
        localStorage.setItem(ACTIVE_KEY, entry.id);
      } catch {
        /* ignore */
      }
    },
    [library, design, paper, persistLibrary]
  );

  const doRename = useCallback(
    async (name: string) => {
      if (!activeTemplate || !name.trim()) return;
      const nextLib: ReceiptLibrary = {
        ...library,
        templates: library.templates.map((x) =>
          x.id === activeId ? { ...x, name: name.trim(), updatedAt: Date.now() } : x
        ),
      };
      await persistLibrary(nextLib, 'Template renamed');
    },
    [activeTemplate, activeId, library, persistLibrary]
  );

  const doDuplicate = useCallback(async () => {
    if (!activeTemplate) return;
    const now = Date.now();
    const entry: ReceiptTemplateEntry = {
      id: newCustomId(),
      name: `${activeTemplate.name} copy`,
      design: { ...design, paper },
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    await persistLibrary({ ...library, templates: [...library.templates, entry] }, 'Template duplicated');
    setActiveId(entry.id);
    setDirty(false);
    try {
      localStorage.setItem(ACTIVE_KEY, entry.id);
    } catch {
      /* ignore */
    }
  }, [activeTemplate, design, paper, library, persistLibrary]);

  const doDelete = useCallback(async () => {
    if (!activeTemplate || activeTemplate.builtin) return;
    if (!window.confirm(`Delete the template “${activeTemplate.name}”? This cannot be undone.`)) return;
    const templates = library.templates.filter((t) => t.id !== activeId);
    const defaults: ReceiptLibrary['defaults'] = { ...library.defaults };
    for (const [k, v] of Object.entries(defaults)) if (v === activeId) delete defaults[k as ReceiptPaper];
    const branchDefaults: ReceiptLibrary['branchDefaults'] = { ...library.branchDefaults };
    for (const [branch, map] of Object.entries(branchDefaults)) {
      const m = { ...map };
      for (const [k, v] of Object.entries(m)) if (v === activeId) delete m[k as ReceiptPaper];
      branchDefaults[branch] = m;
    }
    await persistLibrary({ ...library, templates, defaults, branchDefaults }, 'Template deleted');
    const next = templates[0];
    if (next) {
      const chosen = templateDesign(next);
      designRef.current = chosen;
      setDesign(chosen);
      setPaper(chosen.paper);
      setActiveId(next.id);
      setDirty(false);
    }
  }, [activeTemplate, library, activeId, persistLibrary]);

  const handleReset = useCallback(() => {
    if (!window.confirm('Reset this template to the built-in layout? Your edits will be discarded.')) return;
    const canonical = builtinTemplates().find((t) => t.id === activeId);
    const base = canonical ? templateDesign(canonical) : defaultReceiptDesign(paper);
    commit(base);
    setPaper(base.paper);
    setSelectedId(null);
  }, [activeId, paper, commit]);

  const setDefault = useCallback(async () => {
    if (!activeTemplate) return;
    const nextLib: ReceiptLibrary = { ...library };
    if (defaultScope) {
      nextLib.branchDefaults = {
        ...library.branchDefaults,
        [defaultScope]: { ...(library.branchDefaults[defaultScope] || {}), [paper]: activeId },
      };
    } else {
      nextLib.defaults = { ...library.defaults, [paper]: activeId };
    }
    await persistLibrary(nextLib, `Default for ${paper} set to “${activeTemplate.name}”`);
  }, [activeTemplate, library, defaultScope, paper, activeId, persistLibrary]);

  const handleExport = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rokar-receipt-templates.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Exported templates JSON');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }, [library]);

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        let incoming: ReceiptLibrary;
        if (parsed && typeof parsed === 'object' && (parsed.templates || parsed.defaults || parsed.branchDefaults)) {
          incoming = normalizeLibrary(parsed);
        } else if (parsed && typeof parsed === 'object' && parsed.design && typeof parsed.design === 'object') {
          const now = Date.now();
          incoming = normalizeLibrary({
            templates: [
              { id: newCustomId(), name: parsed.name || 'Imported template', design: parsed.design, createdAt: now, updatedAt: now },
            ],
          });
        } else {
          const now = Date.now();
          incoming = normalizeLibrary({
            templates: [{ id: newCustomId(), name: 'Imported template', design: parsed, createdAt: now, updatedAt: now }],
          });
        }
        const merged = mergeLibraries(library, incoming);
        await persistLibrary(merged, 'Templates imported');
      } catch (e) {
        setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [library, persistLibrary]
  );

  const handleToggleEnabled = useCallback(
    async (on: boolean) => {
      setEnabled(on);
      try {
        await window.api.receipt.setDesign({ ...design, paper }, on);
        setNotice(on ? 'Design applied to printed receipts' : 'Design disabled — the shipped layout is used');
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [design, paper]
  );

  const handleClose = useCallback(() => {
    if (dirty && canEdit && !window.confirm('Discard unsaved changes to this template?')) return;
    if (dirty) clearDraft(activeId);
    onClose();
  }, [dirty, canEdit, activeId, onClose]);

  // Warn before unload if dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && canEdit) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, canEdit]);

  const previewWidth =
    paper === 'thermal80'
      ? 302
      : paper === 'thermal58'
      ? 219
      : paper === 'a5'
      ? Math.round((148 / 25.4) * 96)
      : Math.round((210 / 25.4) * 96);

  const currentDefaultId = defaultScope
    ? library.branchDefaults[defaultScope]?.[paper]
    : library.defaults[paper];
  const currentDefaultName = findTemplate(library, currentDefaultId)?.name;

  return (
    <Modal
      onClose={handleClose}
      title="Receipt Designer"
      style={{ maxWidth: 1400, width: '98%', maxHeight: '95vh' }}
      label="Receipt Designer"
      shortcuts={[
        { keys: 'Ctrl+S', label: 'Save' },
        { keys: 'Ctrl+Z', label: 'Undo' },
        { keys: 'Ctrl+Y', label: 'Redo' },
        { keys: 'Esc', label: 'Close designer' },
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* ── Sticky Top Bar ── */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: 'var(--modal-bg, #fff)',
            borderBottom: '1px solid #e9ecef',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 300 }}>
            <label className="muted small" style={{ whiteSpace: 'nowrap' }}>Template</label>
            <select
              value={activeId}
              onChange={(e) => switchTemplate(e.target.value)}
              style={{ minWidth: 220, maxWidth: '300px' }}
              disabled={!canEdit}
            >
              {library.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.builtin ? ' (built-in)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" disabled={!canEdit || saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {dirty && canEdit && (
              <span className="muted small" style={{ color: '#b45309', fontWeight: 500, marginRight: 8 }}>
                ● Unsaved changes
              </span>
            )}
            <button className="btn btn-sm" disabled={!canEdit} onClick={() => setNameDialog({ mode: 'new', value: `${activeTemplate?.name || 'Template'} copy` })}>
              Save as…
            </button>
            <button className="btn btn-sm" disabled={!canEdit || !activeTemplate} onClick={() => setNameDialog({ mode: 'rename', value: activeTemplate?.name || '' })}>
              Rename
            </button>
            <button className="btn btn-sm" disabled={!canEdit || !activeTemplate} onClick={doDuplicate}>
              Duplicate
            </button>
            <button className="btn btn-sm" disabled={!canEdit || !activeTemplate || activeTemplate.builtin} onClick={doDelete} title={activeTemplate?.builtin ? 'Built-in templates cannot be deleted' : 'Delete template'}>
              Delete
            </button>
            <button className="btn btn-sm" disabled={!canEdit} onClick={handleReset}>
              Reset
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm"
              disabled={!canEdit || testBusy}
              title="Print the sample bill on the receipt printer using the design on screen"
              onClick={async () => {
                setTestBusy(true);
                setNotice('');
                try {
                  const r = await window.api.receipt.testDesign(design, paper, 1);
                  setNotice(r?.message || (r?.ok ? 'Test print sent.' : 'Test print failed.'));
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : String(e));
                } finally {
                  setTestBusy(false);
                }
              }}
            >
              {testBusy ? 'Printing…' : 'Test print'}
            </button>
            <button className="btn btn-sm" disabled={!canEdit || !canUndo} onClick={undo} title="Undo (Ctrl+Z)">
              ↶ Undo
            </button>
            <button className="btn btn-sm" disabled={!canEdit || !canRedo} onClick={redo} title="Redo (Ctrl+Y)">
              ↷ Redo
            </button>
            <button className="btn btn-sm" disabled={!canEdit} onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <button className="btn btn-sm" onClick={handleExport}>
              Export
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {/* ── Secondary Toolbar ── */}
        <div
          style={{
            position: 'sticky',
            top: 56,
            zIndex: 9,
            background: 'var(--modal-bg, #fff)',
            borderBottom: '1px solid #e9ecef',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 300 }}>
            <label className="muted small" style={{ whiteSpace: 'nowrap' }}>Default for</label>
            <select value={defaultScope} onChange={(e) => setDefaultScope(e.target.value)} style={{ minWidth: 150 }} disabled={!canEdit}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" disabled={!canEdit || !activeTemplate} onClick={setDefault}>
              Set as default for {defaultScope ? 'this branch' : 'all branches'}
            </button>
            <span className="muted small">
              {currentDefaultName ? `Default for ${defaultScope || 'all branches'}: ${currentDefaultName}` : 'No default set (uses the applied design)'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                className={enabled ? 'btn btn-primary' : 'btn'}
                disabled={!canEdit || !activeTemplate}
                onClick={() => handleToggleEnabled(true)}
                title="Use this template for printing"
              >
                {enabled ? '✓ Active for printing' : 'Use this template for printing'}
              </button>
              <span className="muted small">
                Currently printing with: {currentDefaultName || (enabled ? activeTemplate?.name : 'Built-in layout')}
              </span>
            </div>
            <div className="muted small" style={{ fontSize: '12px' }}>
              Saving the active template updates printing immediately.
            </div>
          </div>
        </div>

        {/* ── name dialog ── */}
        {nameDialog && (
          <div
            style={{
              position: 'sticky',
              top: 108,
              zIndex: 8,
              background: 'var(--modal-bg, #fff)',
              borderBottom: '1px solid #e9ecef',
              padding: '8px 12px',
            }}
          >
            <div className="row-btns" style={{ gap: 6, alignItems: 'center' }}>
              <label className="muted small">{nameDialog.mode === 'new' ? 'New template name' : 'Rename template'}</label>
              <input
                autoFocus
                value={nameDialog.value}
                onChange={(e) => setNameDialog({ ...nameDialog, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = nameDialog.value.trim();
                    const mode = nameDialog.mode;
                    setNameDialog(null);
                    if (v) void (mode === 'new' ? doSaveAs(v) : doRename(v));
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setNameDialog(null);
                  }
                }}
                style={{ minWidth: 240 }}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  const v = nameDialog.value.trim();
                  const mode = nameDialog.mode;
                  if (!v) return;
                  setNameDialog(null);
                  void (mode === 'new' ? doSaveAs(v) : doRename(v));
                }}
              >
                {nameDialog.mode === 'new' ? 'Create' : 'Rename'}
              </button>
              <button className="btn btn-sm" onClick={() => setNameDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div
            style={{
              position: 'sticky',
              top: nameDialog ? 160 : 108,
              zIndex: 7,
              background: 'var(--modal-bg, #fff)',
              borderBottom: '1px solid #e9ecef',
              padding: '6px 12px',
            }}
          >
            <div className="notice" style={{ margin: 0, padding: '6px 10px', borderRadius: 4, background: '#fff3cd', border: '1px solid #ffe08a' }}>
              {notice}
            </div>
          </div>
        )}

        {/* ── Main Content ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* ── Editor Column (Left) ── */}
          <div
            style={{
              flex: '1 1 600px',
              minWidth: 0,
              overflowY: 'auto',
              padding: '12px',
              borderRight: '1px solid #e9ecef',
              background: 'var(--modal-bg, #fff)',
            }}
          >
            {!canEdit && (
              <div className="notice" style={{ background: '#fff3cd', border: '1px solid #ffe08a', padding: '6px 10px', borderRadius: 6, marginBottom: 12 }}>
                Read-only: only an owner / admin can edit receipt templates.
              </div>
            )}

            {/* Paper & Sample Settings */}
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="panel-title">Document Settings</div>
              <div className="form-row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Paper Size</label>
                  <select
                    value={paper}
                    onChange={(e) => {
                      const p = e.target.value as ReceiptPaper;
                      setPaper(p);
                      patchDesign({ paper: p });
                    }}
                    disabled={!canEdit}
                  >
                    {RECEIPT_PAPERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Preview Sample</label>
                  <select value={sample} onChange={(e) => setSample(e.target.value as 'sale' | 'return')} disabled={!canEdit}>
                    <option value="sale">Normal sale</option>
                    <option value="return">Return / refund (negative)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Sections */}
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Sections</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={newBlockType}
                    onChange={(e) => setNewBlockType(e.target.value as ReceiptBlockType)}
                    disabled={!canEdit}
                    style={{ minWidth: 200 }}
                  >
                    {CUSTOM_BLOCK_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {BLOCK_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-sm btn-primary" onClick={addBlock} disabled={!canEdit}>
                    Add block
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <table className="data-table" style={{ minWidth: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}>On</th>
                      <th style={{ textAlign: 'left' }}>Block</th>
                      <th style={{ width: 220, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {design.sections.map((b, i) => (
                      <>
                        <tr
                          onClick={() => { setSelectedId(b.id); setExpandedId(expandedId === b.id ? null : b.id); }}
                          style={{ cursor: 'pointer', background: selectedId === b.id ? 'rgba(220,53,69,0.08)' : (expandedId === b.id ? '#f8f9fa' : undefined) }}
                        >
                          <td style={{ width: 30 }}>
                            <input
                              type="checkbox"
                              checked={b.enabled}
                              onClick={(e) => { e.stopPropagation(); updateBlock(b.id, { enabled: (e.target as HTMLInputElement).checked }); }}
                              title="Show / hide"
                              disabled={!canEdit}
                            />
                          </td>
                          <td>
                            <span style={{ fontWeight: 500 }}>{BLOCK_LABELS[b.type]}</span>
                            {b.text && <span className="muted small" style={{ marginLeft: 8 }}> — {b.text.slice(0, 50)}</span>}
                            {expandedId === b.id && <span className="muted small" style={{ marginLeft: 8 }}>▼</span>}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              className="btn btn-sm"
                              disabled={i === 0 || !canEdit}
                              onClick={(e) => { e.stopPropagation(); move(b.id, -1); }}
                              title="Move up"
                            >
                              ↑
                            </button>{' '}
                            <button
                              className="btn btn-sm"
                              disabled={i === design.sections.length - 1 || !canEdit}
                              onClick={(e) => { e.stopPropagation(); move(b.id, 1); }}
                              title="Move down"
                            >
                              ↓
                            </button>{' '}
                            <button
                              className="btn btn-sm"
                              disabled={!canEdit}
                              onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === b.id ? null : b.id); setSelectedId(b.id); }}
                              title={expandedId === b.id ? 'Collapse' : 'Edit'}
                            >
                              {expandedId === b.id ? 'Collapse' : 'Edit'}
                            </button>{' '}
                            <button
                              className="btn btn-sm"
                              disabled={!canEdit}
                              onClick={(e) => { e.stopPropagation(); duplicateBlock(b.id); }}
                              title="Duplicate"
                            >
                              ↻
                            </button>{' '}
                            {CUSTOM_BLOCK_TYPES.includes(b.type) ? (
                              <button
                                className="btn btn-sm"
                                style={{ color: '#b91c1c' }}
                                onClick={(e) => { e.stopPropagation(); removeBlock(b.id); if (expandedId === b.id) setExpandedId(null); }}
                                title="Remove"
                                disabled={!canEdit}
                              >
                                ✕
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {expandedId === b.id && selected && (
                          <tr>
                            <td colSpan={3} style={{ padding: 0 }}>
                              <div style={{ padding: '12px', background: '#f8f9fa', borderTop: '1px solid #e9ecef' }}>
                                <BlockProperties
                                  block={selected}
                                  canEdit={canEdit}
                                  onPatch={(p) => updateBlock(selected.id, p)}
                                  onStyle={(p) => updateStyle(selected.id, p)}
                                  shopSettings={shopSettings}
                                  onClose={() => setExpandedId(null)}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Table Options */}
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="panel-title">Items Table</div>
              <div className="form-row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                {design.table.columns.map((c, i) => (
                  <label key={c.key} className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 120 }}>
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => {
                        const cols = design.table.columns.map((x, xi) => (xi === i ? { ...x, enabled: e.target.checked } : x));
                        patchDesign({ table: { ...design.table, columns: cols } });
                      }}
                      disabled={!canEdit}
                    />
                    {TABLE_COLUMN_LABELS[c.key]}
                  </label>
                ))}
              </div>
              <div className="form-row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <label className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={design.table.showHeader} onChange={(e) => patchDesign({ table: { ...design.table, showHeader: e.target.checked } })} disabled={!canEdit} /> Header row
                </label>
                <label className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={design.table.rowSeparators} onChange={(e) => patchDesign({ table: { ...design.table, rowSeparators: e.target.checked } })} disabled={!canEdit} /> Row separators
                </label>
                <label className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={design.table.boldItemNames} onChange={(e) => patchDesign({ table: { ...design.table, boldItemNames: e.target.checked } })} disabled={!canEdit} /> Bold item names
                </label>
                <label className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={design.table.urduNameUnderEnglish} onChange={(e) => patchDesign({ table: { ...design.table, urduNameUnderEnglish: e.target.checked } })} disabled={!canEdit} /> Urdu name under English
                </label>
              </div>
              <div className="form-row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                  <label>Item font size (px)</label>
                  <input
                    type="number"
                    value={design.table.fontSizePx ?? 13}
                    onChange={(e) => patchDesign({ table: { ...design.table, fontSizePx: Number(e.target.value) } })}
                    disabled={!canEdit}
                  />
                </div>
              </div>
              <div className="form-row" style={{ gap: 12, flexWrap: 'wrap' }}>
                {design.table.columns.map((c, i) => (
                  <div key={c.key} className="form-group" style={{ flex: 1, minWidth: 100, maxWidth: 150 }}>
                    <label>{TABLE_COLUMN_LABELS[c.key]}</label>
                    <input
                      style={{ width: '100%' }}
                      placeholder={TABLE_COLUMN_LABELS[c.key]}
                      value={c.width ?? ''}
                      onChange={(e) => {
                        const cols = design.table.columns.map((x, xi) => (xi === i ? { ...x, width: e.target.value } : x));
                        patchDesign({ table: { ...design.table, columns: cols } });
                      }}
                      disabled={!canEdit}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Global Options */}
            <div className="panel">
              <div className="panel-title">Global</div>
              <div className="form-row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Base font size (px)</label>
                  <input type="number" value={design.global.baseFontSizePx ?? 13} onChange={(e) => patchDesign({ global: { ...design.global, baseFontSizePx: Number(e.target.value) } })} disabled={!canEdit} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Page margin (mm)</label>
                  <input type="number" value={design.global.marginMm ?? 4} onChange={(e) => patchDesign({ global: { ...design.global, marginMm: Number(e.target.value) } })} disabled={!canEdit} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Chars / line (ESC/POS)</label>
                  <input type="number" value={design.global.charsPerLine ?? 32} onChange={(e) => patchDesign({ global: { ...design.global, charsPerLine: Number(e.target.value) } })} disabled={!canEdit} />
                </div>
              </div>
              <div className="form-row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Currency symbol</label>
                  <input value={design.global.currencySymbol ?? ''} onChange={(e) => patchDesign({ global: { ...design.global, currencySymbol: e.target.value } })} disabled={!canEdit} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Currency position</label>
                  <select value={design.global.currencyPosition ?? 'before'} onChange={(e) => patchDesign({ global: { ...design.global, currencyPosition: e.target.value as 'before' | 'after' } })} disabled={!canEdit}>
                    <option value="before">Before (Rs 100)</option>
                    <option value="after">After (100 Rs)</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 100 }}>
                  <label>Decimals</label>
                  <input type="number" value={design.global.decimals ?? 2} onChange={(e) => patchDesign({ global: { ...design.global, decimals: Number(e.target.value) } })} disabled={!canEdit} />
                </div>
              </div>
              <div className="form-row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Thousand separators</label>
                  <input type="checkbox" checked={design.global.thousandSeparator !== false} onChange={(e) => patchDesign({ global: { ...design.global, thousandSeparator: e.target.checked } })} disabled={!canEdit} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Date format</label>
                  <select value={design.global.dateFormat ?? 'dd/mm/yyyy'} onChange={(e) => patchDesign({ global: { ...design.global, dateFormat: e.target.value } })} disabled={!canEdit}>
                    <option value="dd/mm/yyyy">dd/mm/yyyy</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                  <label>Urdu font</label>
                  <input value={design.global.urduFontFamily ?? ''} onChange={(e) => patchDesign({ global: { ...design.global, urduFontFamily: e.target.value } })} disabled={!canEdit} />
                </div>
              </div>
            </div>

            {/* Save Button at bottom of editor */}
            <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid #e9ecef' }}>
              {dirty && <span className="muted small" style={{ marginRight: 'auto', color: '#b45309', fontWeight: 500 }}>● Unsaved changes</span>}
              <button className="btn btn-primary" disabled={!canEdit || saving} onClick={handleSave} style={{ minWidth: 140 }}>
                {saving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>

          {/* ── Preview Column (Right) ── */}
          <div
            style={{
              flex: '0 0 400px',
              minWidth: 360,
              maxWidth: '45vw',
              borderLeft: '1px solid #e9ecef',
              background: '#fafafa',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '12px', borderBottom: '1px solid #e9ecef', position: 'sticky', top: 0, background: '#fafafa', zIndex: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="panel-title" style={{ margin: 0 }}>Live preview <span className="muted small">({sample === 'return' ? 'return' : 'sale'})</span></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={sample === 'return'} onChange={(e) => setSample(e.target.checked ? 'return' : 'sale')} /> Return sample
                  </label>
                </div>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '12px',
                background: '#fff',
              }}
            >
              <div style={{ border: '1px solid #ccc', borderRadius: 6, background: '#fff', overflow: 'auto' }}>
                <iframe
                  title="Receipt preview"
                  srcDoc={previewHtml}
                  style={{
                    width: previewWidth,
                    height: paper === 'a4' || paper === 'a5' ? 620 : 520,
                    border: '1px solid #eee',
                    background: '#fff',
                    transform: paper === 'a4' ? 'scale(0.72)' : paper === 'a5' ? 'scale(0.9)' : undefined,
                    transformOrigin: 'top left',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BlockProperties({
  block,
  canEdit,
  onPatch,
  onStyle,
  shopSettings,
  onClose,
}: {
  block: ReceiptBlock;
  canEdit: boolean;
  onPatch: (p: Partial<ReceiptBlock>) => void;
  onStyle: (p: Partial<ReceiptBlock['style']>) => void;
  shopSettings: { name: string; address: string; phone: string; whatsapp: string; taxNo: string } | null;
  onClose: () => void;
}) {
  const style = block.style || {};

  // Local state for text editing to prevent re-render cascade on every keystroke
  const [localText, setLocalText] = useState(block.text ?? '');
  const [localLabel, setLocalLabel] = useState(block.label ?? '');
  const [localValue, setLocalValue] = useState(block.value ?? '');
  const [localVariant, setLocalVariant] = useState(block.variant ?? 'dashed');
  const [localHeightMm, setLocalHeightMm] = useState(block.heightMm ?? 3);
  const [localSrc, setLocalSrc] = useState(block.src ?? '');
  const [branchOverrides, setBranchOverrides] = useState<Record<string, string>>({});

  // Debounced commit to main design
  const commitRef = useRef<number | null>(null);
  const commitLocal = useCallback(() => {
    onPatch({
      text: localText || undefined,
      label: localLabel || undefined,
      value: localValue || undefined,
      variant: localVariant,
      heightMm: localHeightMm,
      src: localSrc || undefined,
      branchOverrides: Object.keys(branchOverrides).length > 0 ? branchOverrides : undefined,
    });
  }, [onPatch, localText, localLabel, localValue, localVariant, localHeightMm, localSrc, branchOverrides]);

  const debouncedCommit = useCallback(() => {
    if (commitRef.current) clearTimeout(commitRef.current);
    commitRef.current = window.setTimeout(() => {
      commitLocal();
    }, 300);
  }, [commitLocal]);

  // Sync local state when block prop changes (e.g., when selecting different block)
  useEffect(() => {
    setLocalText(block.text ?? '');
    setLocalLabel(block.label ?? '');
    setLocalValue(block.value ?? '');
    setLocalVariant(block.variant ?? 'dashed');
    setLocalHeightMm(block.heightMm ?? 3);
    setLocalSrc(block.src ?? '');
    setBranchOverrides(block.branchOverrides ?? {});
  }, [block.text, block.label, block.value, block.variant, block.heightMm, block.src, block.branchOverrides]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (commitRef.current) clearTimeout(commitRef.current);
    };
  }, []);

  // Token insertion helper
  const insertToken = (token: string) => {
    setLocalText((prev) => prev + `{${token}}`);
    debouncedCommit();
  };

  // Reset to settings value
  const resetToSettings = (field: 'name' | 'address' | 'phone' | 'whatsapp' | 'taxNo') => {
    if (!shopSettings) return;
    const value = shopSettings[field] || '';
    if (field === 'name') setLocalText(value);
    else if (field === 'address') setLocalText(value);
    else if (field === 'phone') setLocalText(value);
    else if (field === 'whatsapp') setLocalText(value);
    else if (field === 'taxNo') setLocalText(value);
    debouncedCommit();
  };

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="panel-title">{BLOCK_LABELS[block.type]} — properties</div>
        <button className="btn btn-sm" onClick={onClose} title="Close">Close</button>
      </div>

      {/* Built-in blocks with specific fields */}
      {block.type === 'logo' && (
        <div className="form-group">
          <label>Max Height (mm)</label>
          <input type="number" value={style.maxHeightMm ?? 12} onChange={(e) => onStyle({ maxHeightMm: Number(e.target.value) })} disabled={!canEdit} />
          <div className="muted small">Maximum logo height on receipt</div>
        </div>
      )}

      {block.type === 'shop_name' && (
        <div className="form-group">
          <label>Text</label>
          <textarea rows={2} value={localText} onChange={(e) => { setLocalText(e.target.value); debouncedCommit(); }} disabled={!canEdit} />
          <div className="row-btns" style={{ marginTop: 4 }}>
            {shopSettings && (
              <button className="btn btn-sm" onClick={() => resetToSettings('name')} disabled={!canEdit}>
                Use Settings Value
              </button>
            )}
            <div className="muted small">Tokens: {RECEIPT_TOKENS.map((t) => `{${t}}`).join(' ')}</div>
          </div>
        </div>
      )}

      {block.type === 'address' && (
        <div className="form-group">
          <label>Address (Multi-line)</label>
          <textarea rows={4} value={localText} onChange={(e) => { setLocalText(e.target.value); debouncedCommit(); }} disabled={!canEdit} placeholder="Enter address lines, one per line" />
          <div className="row-btns" style={{ marginTop: 4, flexWrap: 'wrap', gap: 4 }}>
            {shopSettings && (
              <button className="btn btn-sm" onClick={() => resetToSettings('address')} disabled={!canEdit}>
                Use Settings Value
              </button>
            )}
            <button className="btn btn-sm" onClick={() => { setLocalText(''); debouncedCommit(); }} disabled={!canEdit}>
              Clear
            </button>
            <div className="muted small">Tokens: {RECEIPT_TOKENS.map((t) => `{${t}}`).join(' ')}</div>
          </div>
          {/* Branch override addresses */}
          {canEdit && (
            <div style={{ marginTop: 12, padding: 8, background: '#f8f9fa', borderRadius: 4 }}>
              <div className="muted small" style={{ marginBottom: 8, fontWeight: 600 }}>Branch Address Overrides</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { id: 'Faqirwali', name: 'Faqirwali' },
                  { id: 'Haroonabad', name: 'Haroonabad' },
                  { id: 'Chishtian', name: 'Chishtian' },
                  { id: 'Dharanwala', name: 'Dharanwala' },
                ].map((branch) => (
                  <div key={branch.id} style={{ flex: 1, minWidth: 180 }}>
                    <label style={{ display: 'block', marginBottom: 4 }}>
                      <span className="muted small">{branch.name}</span>
                      <input
                        type="text"
                        value={branchOverrides[branch.id] || ''}
                        onChange={(e) => {
                          const next = { ...branchOverrides };
                          if (e.target.value.trim()) next[branch.id] = e.target.value.trim();
                          else delete next[branch.id];
                          setBranchOverrides(next);
                        }}
                        placeholder="Override address for this branch"
                        style={{ width: '100%', marginTop: 2 }}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {['phone_whatsapp', 'phone', 'whatsapp'].includes(block.type) && (
        <div className="form-group">
          <label>Text</label>
          <textarea rows={2} value={localText} onChange={(e) => { setLocalText(e.target.value); debouncedCommit(); }} disabled={!canEdit} />
          <div className="row-btns" style={{ marginTop: 4 }}>
            {shopSettings && (
              <>
                <button className="btn btn-sm" onClick={() => resetToSettings('phone')} disabled={!canEdit}>
                  Use Settings Phone
                </button>
                <button className="btn btn-sm" onClick={() => resetToSettings('whatsapp')} disabled={!canEdit}>
                  Use Settings WhatsApp
                </button>
              </>
            )}
            <div className="muted small">Tokens: {RECEIPT_TOKENS.map((t) => `{${t}}`).join(' ')}</div>
          </div>
        </div>
      )}

      {block.type === 'tax_no' && (
        <div className="form-group">
          <label>Tax Number</label>
          <textarea rows={2} value={localText} onChange={(e) => { setLocalText(e.target.value); debouncedCommit(); }} disabled={!canEdit} />
          <div className="row-btns" style={{ marginTop: 4 }}>
            {shopSettings && (
              <button className="btn btn-sm" onClick={() => resetToSettings('taxNo')} disabled={!canEdit}>
                Use Settings Value
              </button>
            )}
            <div className="muted small">Tokens: {RECEIPT_TOKENS.map((t) => `{${t}}`).join(' ')}</div>
          </div>
        </div>
      )}

      {['header_note', 'footer_note_1', 'footer_note_2', 'banner', 'return_policy', 'thank_you'].includes(block.type) && (
        <div className="form-group">
          <label>Text</label>
          <textarea rows={3} value={localText} onChange={(e) => { setLocalText(e.target.value); debouncedCommit(); }} disabled={!canEdit} />
          <div className="row-btns" style={{ marginTop: 4 }}>
            <div className="muted small" style={{ marginRight: 8 }}>Tokens:</div>
            {RECEIPT_TOKENS.slice(0, 8).map((t) => (
              <button key={t} className="btn btn-sm" type="button" onClick={() => insertToken(t)} disabled={!canEdit}>
                {"{"+t+"}"}
              </button>
            ))}
            <div style={{ width: 8 }} />
            {RECEIPT_TOKENS.slice(8).map((t) => (
              <button key={t} className="btn btn-sm" type="button" onClick={() => insertToken(t)} disabled={!canEdit}>
                {"{"+t+"}"}
              </button>
            ))}
          </div>
        </div>
      )}

      {block.type === 'software_credit' && (
        <div className="form-group">
          <label>Text</label>
          <textarea rows={2} value={localText} onChange={(e) => { setLocalText(e.target.value); debouncedCommit(); }} disabled={!canEdit} />
          <div className="row-btns" style={{ marginTop: 4 }}>
            <button className="btn btn-sm" onClick={() => { setLocalText(''); debouncedCommit(); }} disabled={!canEdit}>
              Remove (set empty)
            </button>
            <div className="muted small">Leave empty to hide completely</div>
          </div>
        </div>
      )}

      {block.type === 'two_col' && (
        <div className="form-row">
          <div className="form-group">
            <label>Label</label>
            <input value={localLabel} onChange={(e) => { setLocalLabel(e.target.value); debouncedCommit(); }} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Value</label>
            <input value={localValue} onChange={(e) => { setLocalValue(e.target.value); debouncedCommit(); }} disabled={!canEdit} />
          </div>
        </div>
      )}

      {block.type === 'divider' && (
        <div className="form-group">
          <label>Style</label>
          <select value={localVariant} onChange={(e) => { setLocalVariant(e.target.value); debouncedCommit(); }} disabled={!canEdit}>
            <option value="dashed">Dashed</option>
            <option value="solid">Solid</option>
            <option value="double">Double</option>
            <option value="blank">Blank space</option>
          </select>
        </div>
      )}

      {block.type === 'spacer' && (
        <div className="form-group">
          <label>Height (mm)</label>
          <input type="number" value={localHeightMm} onChange={(e) => { setLocalHeightMm(Number(e.target.value)); debouncedCommit(); }} disabled={!canEdit} />
        </div>
      )}

      {block.type === 'image' && (
        <div className="form-group">
          <label>Image URL / data URL</label>
          <input value={localSrc} onChange={(e) => { setLocalSrc(e.target.value); debouncedCommit(); }} placeholder="https://… or data:image/png;base64,…" disabled={!canEdit} />
        </div>
      )}

      {block.type === 'qr' && (
        <div className="form-group">
          <label>QR Value (tokens allowed)</label>
          <input value={localValue} onChange={(e) => { setLocalValue(e.target.value); debouncedCommit(); }} placeholder="{invoice}" disabled={!canEdit} />
          <div className="muted small">Tokens: {RECEIPT_TOKENS.map((t) => `{${t}}`).join(' ')}</div>
        </div>
      )}

      {block.type === 'barcode' && (
        <div className="form-group">
          <label>Barcode Value (tokens allowed)</label>
          <input value={localValue} onChange={(e) => { setLocalValue(e.target.value); debouncedCommit(); }} placeholder="{invoice}" disabled={!canEdit} />
          <div className="muted small">Tokens: {RECEIPT_TOKENS.map((t) => `{${t}}`).join(' ')}</div>
        </div>
      )}

      {block.type === 'return_banner' && (
        <div className="muted small">Shows automatically on a returned / negative sale (title: RETURN / REFUND).</div>
      )}

      {/* Common style properties for all blocks */}
      <div className="panel" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e9ecef' }}>
        <div className="panel-title">Style</div>
        <div className="form-row">
          <div className="form-group">
            <label>Font size (px)</label>
            <input type="number" value={style.fontSizePx ?? STYLE_DEFAULTS.fontSizePx} onChange={(e) => onStyle({ fontSizePx: Number(e.target.value) })} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Align</label>
            <select value={style.align ?? ''} onChange={(e) => onStyle({ align: (e.target.value || undefined) as 'left' | 'center' | 'right' | undefined })} disabled={!canEdit}>
              <option value="">Default</option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className="form-group">
            <label>Line height</label>
            <input type="number" step="0.05" value={style.lineHeight ?? ''} onChange={(e) => onStyle({ lineHeight: e.target.value ? Number(e.target.value) : undefined })} disabled={!canEdit} />
          </div>
        </div>
        <div className="row-btns" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="muted small">
            <input type="checkbox" checked={!!style.bold} onChange={(e) => onStyle({ bold: e.target.checked })} disabled={!canEdit} /> Bold
          </label>
          <label className="muted small">
            <input type="checkbox" checked={!!style.italic} onChange={(e) => onStyle({ italic: e.target.checked })} disabled={!canEdit} /> Italic
          </label>
          <label className="muted small">
            <input type="checkbox" checked={!!style.uppercase} onChange={(e) => onStyle({ uppercase: e.target.checked })} disabled={!canEdit} /> UPPERCASE
          </label>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Margin top (mm)</label>
            <input type="number" step="0.1" value={style.marginTopMm ?? ''} onChange={(e) => onStyle({ marginTopMm: e.target.value ? Number(e.target.value) : undefined })} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Margin bottom (mm)</label>
            <input type="number" step="0.1" value={style.marginBottomMm ?? ''} onChange={(e) => onStyle({ marginBottomMm: e.target.value ? Number(e.target.value) : undefined })} disabled={!canEdit} />
          </div>
        </div>
      </div>
    </div>
  );
}
