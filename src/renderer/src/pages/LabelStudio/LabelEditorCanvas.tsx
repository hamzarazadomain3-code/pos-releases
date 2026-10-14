import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Modal } from '@components/Modal';
import { KeyboardInput } from '@components/KeyboardInput';
import { ElementPropertiesPanel } from './ElementPropertiesPanel';
import type { LabelTemplate, LabelElement } from './types';

interface Props {
  template: LabelTemplate;
  sizeSpec: { w: number; h: number; gap: number };
  onSave: (elements: LabelElement[]) => void;
}

const GRID_SIZE = 1;
const SYMBOLOGIES = ['CODE128', 'EAN13', 'EAN8', 'UPCA', 'CODE39', 'ITF', 'QR', 'DataMatrix'];
const FONTS = ['Segoe UI', 'Arial', 'Tahoma', 'Noto Nastaliq Urdu', 'Jameel Noori Nastaliq', 'Consolas', 'Courier New'];
const URDU_FONTS = ['Noto Nastaliq Urdu', 'Jameel Noori Nastaliq'];
const ROTATION_SNAP = 15;
const ALIGNMENT_THRESHOLD = 5;

const PLACEHOLDERS = [
  '{name}', '{price}', '{sku}', '{barcode}', '{expiry}', 
  '{mfg}', '{batch}', '{weight}', '{shop}', '{category}', 
  '{date}', '{qty}', '{old_price}', '{sale_price}'
];

function generateId() {
  return `el-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createElement(type: LabelElement['type'], labelW: number, labelH: number): LabelElement {
  const base = {
    id: generateId(),
    type,
    x: labelW / 2 - 10,
    y: labelH / 2 - 5,
    w: 20,
    h: 10,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fontFamily: 'Segoe UI', fontSize: 7, bold: false, italic: false, align: 'center' as const, color: '#000', borderWidth: 1, borderColor: '#000', borderStyle: 'solid' },
    content: '',
    barcodeOptions: { symbology: 'CODE128', height: 8, barWidth: 2, showText: true, quietZone: 1, validateEan: true },
  };

  switch (type) {
    case 'text': return { ...base, content: '{name}', w: 30, h: 6 };
    case 'barcode': return { ...base, content: '{barcode}', w: 30, h: 12 };
    case 'qr': return { ...base, content: '{barcode}', w: 15, h: 15 };
    case 'image': return { ...base, content: '/logo.png', w: 20, h: 10 };
    case 'line': return { ...base, w: 30, h: 0.5 };
    case 'rect': return { ...base, w: 30, h: 15 };
    case 'custom-text': return { ...base, content: '{name} - {price}', w: 40, h: 8 };
    case 'price': return { ...base, content: '{price}', w: 30, h: 8, style: { ...base.style, fontSize: 12, bold: true, fontWeight: '700' } };
    case 'expiry': return { ...base, content: 'Exp {expiry}', w: 40, h: 6 };
    case 'mfg': return { ...base, content: 'Mfg {mfg}', w: 40, h: 6 };
    case 'batch': return { ...base, content: 'Batch {batch}', w: 40, h: 6 };
    case 'weight': return { ...base, content: '{weight} {unit}', w: 30, h: 6 };
    case 'sku': return { ...base, content: 'SKU: {sku}', w: 40, h: 6 };
    case 'border': return { ...base, content: '', w: 30, h: 20, style: { ...base.style, borderWidth: 2, borderColor: '#000', borderStyle: 'solid' } };
    default: return base;
  }
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function LabelEditorCanvas({ template, sizeSpec, onSave }: Props) {
  const [elements, setElements] = useState<LabelElement[]>(template.elements.map(e => ({ ...e })));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<LabelElement[][]>([template.elements]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showElementProps, setShowElementProps] = useState(false);
  const [zoom, setZoom] = useState(150);
  const [alignmentGuides, setAlignmentGuides] = useState<{ x?: number; y?: number }>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelW = sizeSpec.w;
  const labelH = sizeSpec.h;

  const pushHistory = useCallback((newElements: LabelElement[]) => {
    setHistory(prev => prev.slice(0, historyIndex + 1).concat([newElements]));
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setElements(history[historyIndex - 1]);
      setSelectedId(null);
      setSelectedIds([]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setElements(history[historyIndex + 1]);
      setSelectedId(null);
      setSelectedIds([]);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        if (selectedIds.length > 1) deleteSelectedElements();
        else if (selectedId) deleteElement(selectedId);
      }
      if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedIds.length > 1) duplicateSelectedElements();
        else if (selectedId) duplicateElement(selectedId);
      }
      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
      if (isArrow && (selectedId || selectedIds.length > 0)) {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        const targets = selectedIds.length > 1 ? selectedIds : (selectedId ? [selectedId] : []);
        for (const id of targets) {
          const el = elements.find(e => e.id === id);
          if (el && !el.locked) {
            updateElement(id, { x: snapToGrid(el.x + dx), y: snapToGrid(el.y + dy) });
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, selectedId, selectedIds, elements]);

  const selectedEl = elements.find(e => e.id === selectedId);
  const selectedElements = elements.filter(e => selectedIds.includes(e.id));

  const selectElement = (id: string | null, e?: React.MouseEvent | KeyboardEvent) => {
    const isMultiSelect = e && (e.shiftKey || e.ctrlKey || e.metaKey);
    if (isMultiSelect && id) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
      setSelectedId(id);
      setShowElementProps(true);
    } else {
      setSelectedId(id);
      setSelectedIds(id ? [id] : []);
      setShowElementProps(!!id);
    }
  };

  const updateElement = (id: string, updates: Partial<LabelElement>) => {
    const newElements = elements.map(el => el.id === id ? { ...el, ...updates } : el);
    setElements(newElements);
    pushHistory(newElements);
  };

  const updateSelectedElements = (updates: Partial<LabelElement>) => {
    if (selectedIds.length === 0) return;
    const newElements = elements.map(el =>
      selectedIds.includes(el.id) ? { ...el, ...updates } : el
    );
    setElements(newElements);
    pushHistory(newElements);
  };

  const deleteElement = (id: string) => {
    const newElements = elements.filter(el => el.id !== id);
    setElements(newElements);
    pushHistory(newElements);
    setSelectedId(null);
    setSelectedIds([]);
  };

  const deleteSelectedElements = () => {
    if (selectedIds.length === 0) return;
    const newElements = elements.filter(el => !selectedIds.includes(el.id));
    setElements(newElements);
    pushHistory(newElements);
    setSelectedId(null);
    setSelectedIds([]);
  };

  const duplicateElement = (id: string) => {
    const el = elements.find(e => e.id === id);
    if (!el) return;
    const dup: LabelElement = { ...el, id: generateId(), x: snapToGrid(el.x + 2), y: snapToGrid(el.y + 2) };
    const newElements = [...elements, dup];
    setElements(newElements);
    pushHistory(newElements);
    setSelectedId(dup.id);
    setSelectedIds([dup.id]);
  };

  const duplicateSelectedElements = () => {
    if (selectedIds.length === 0) return;
    const newElements = [...elements];
    const newSelectedIds: string[] = [];
    for (const id of selectedIds) {
      const el = elements.find(e => e.id === id);
      if (el) {
        const dup: LabelElement = { ...el, id: generateId(), x: snapToGrid(el.x + 2), y: snapToGrid(el.y + 2) };
        newElements.push(dup);
        newSelectedIds.push(dup.id);
      }
    }
    setElements(newElements);
    pushHistory(newElements);
    setSelectedIds(newSelectedIds);
  };

  const distributeHorizontally = () => {
    if (selectedIds.length < 3) return;
    const selected = elements.filter(e => selectedIds.includes(e.id)).sort((a, b) => a.x - b.x);
    const leftmost = selected[0].x;
    const rightmost = selected[selected.length - 1].x + selected[selected.length - 1].w;
    const totalWidth = selected.reduce((sum, el) => sum + el.w, 0);
    const gap = (rightmost - leftmost - totalWidth) / (selected.length - 1);
    let currentX = leftmost;
    selected.forEach((el, i) => {
      if (i === 0) return;
      currentX += gap;
      updateElement(el.id, { x: snapToGrid(currentX) });
      currentX += el.w;
    });
  };

  const distributeVertically = () => {
    if (selectedIds.length < 3) return;
    const selected = elements.filter(e => selectedIds.includes(e.id)).sort((a, b) => a.y - b.y);
    const topmost = selected[0].y;
    const bottommost = selected[selected.length - 1].y + selected[selected.length - 1].h;
    const totalHeight = selected.reduce((sum, el) => sum + el.h, 0);
    const gap = (bottommost - topmost - totalHeight) / (selected.length - 1);
    let currentY = topmost;
    selected.forEach((el, i) => {
      if (i === 0) return;
      currentY += gap;
      updateElement(el.id, { y: snapToGrid(currentY) });
      currentY += el.h;
    });
  };

  const addElement = (type: LabelElement['type']) => {
    const el = createElement(type, labelW, labelH);
    const newElements = [...elements, el];
    setElements(newElements);
    pushHistory(newElements);
    setSelectedId(el.id);
    setSelectedIds([el.id]);
  };

  const handleMouseDown = (e: React.MouseEvent, id: string, type: 'move' | 'resize' | 'rotate', handle?: string) => {
    const el = elements.find(e => e.id === id);
    if (!el || el.locked) return;
    e.preventDefault();
    e.stopPropagation();
    selectElement(id);
    setDragState({
      type,
      elementId: id,
      startX: e.clientX,
      startY: e.clientY,
      startElement: { ...el },
      handle: handle ?? null,
    });
  };

  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize' | 'rotate' | null;
    elementId: string | null;
    startX: number;
    startY: number;
    startElement: LabelElement | null;
    handle: string | null;
  }>({ type: null, elementId: null, startX: 0, startY: 0, startElement: null, handle: null });

  useEffect(() => {
    if (!dragState.elementId) return;

    const calculateAlignmentGuides = (targetX: number, targetY: number, targetW: number, targetH: number) => {
      const guides: { x?: number; y?: number } = {};
      const threshold = ALIGNMENT_THRESHOLD / (zoom / 100);

      elements.forEach(el => {
        if (el.id === dragState.elementId) return;
        if (el.locked) return;

        const leftEdges = [el.x, el.x + el.w / 2, el.x + el.w];
        const targetLeftEdges = [targetX, targetX + targetW / 2, targetX + targetW];

        leftEdges.forEach(le => {
          targetLeftEdges.forEach(tle => {
            if (Math.abs(le - tle) < threshold) guides.x = le;
          });
        });

        const topEdges = [el.y, el.y + el.h / 2, el.y + el.h];
        const targetTopEdges = [targetY, targetY + targetH / 2, targetY + targetH];

        topEdges.forEach(te => {
          targetTopEdges.forEach(tte => {
            if (Math.abs(te - tte) < threshold) guides.y = te;
          });
        });
      });

      return guides;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const { type, startX, startY, startElement, handle } = dragState;
      if (!startElement) return;

      const dx = (e.clientX - startX) / (zoom / 100);
      const dy = (e.clientY - startY) / (zoom / 100);

      let updates: Partial<LabelElement> = {};
      let guides: { x?: number; y?: number } = {};

      if (type === 'move') {
        const newX = snapToGrid(startElement.x + dx);
        const newY = snapToGrid(startElement.y + dy);
        updates.x = newX;
        updates.y = newY;
        guides = calculateAlignmentGuides(newX, newY, startElement.w, startElement.h);
      } else if (type === 'resize' && handle) {
        let nw = startElement.w, nh = startElement.h, nx = startElement.x, ny = startElement.y;
        if (handle.includes('e')) nw = Math.max(2, snapToGrid(startElement.w + dx));
        if (handle.includes('w')) { nx = snapToGrid(startElement.x + dx); nw = Math.max(2, startElement.w - dx); }
        if (handle.includes('s')) nh = Math.max(2, snapToGrid(startElement.h + dy));
        if (handle.includes('n')) { ny = snapToGrid(startElement.y + dy); nh = Math.max(2, startElement.h - dy); }
        updates = { x: nx, y: ny, w: nw, h: nh };
        guides = calculateAlignmentGuides(nx, ny, nw, nh);
      } else if (type === 'rotate') {
        const cx = startElement.x + startElement.w / 2;
        const cy = startElement.y + startElement.h / 2;
        const angle = Math.atan2(e.clientY - cy * (zoom / 100), e.clientX - cx * (zoom / 100)) * 180 / Math.PI;
        updates.rotation = Math.round(angle / ROTATION_SNAP) * ROTATION_SNAP;
      }

      if (Object.keys(guides).length > 0) setAlignmentGuides(guides);
      else setAlignmentGuides({});

      if (selectedIds.length > 1 && type === 'move') {
        const dx2 = snapToGrid(startElement.x + dx) - startElement.x;
        const dy2 = snapToGrid(startElement.y + dy) - startElement.y;
        for (const id of selectedIds) {
          if (id === dragState.elementId) return;
          const el = elements.find(e => e.id === id);
          if (el && !el.locked) updateElement(id, { x: snapToGrid(el.x + dx2), y: snapToGrid(el.y + dy2) });
        }
      }

      updateElement(dragState.elementId!, updates);
    };

    const handleMouseUp = () => setDragState({ type: null, elementId: null, startX: 0, startY: 0, startElement: null, handle: null });

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [dragState, elements, zoom, updateElement]);

  const renderHandles = (el: LabelElement) => {
    if (el.locked) return null;
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    return handles.map(h => (
      <div
        key={h}
        className={`resize-handle ${h}`}
        style={{
          position: 'absolute', width: '8px', height: '8px',
          background: '#2563eb',
          border: '1px solid #fff',
          borderRadius: '2px',
          left: `${h.includes('w') ? -4 : h.includes('e') ? 'calc(100% - 4px)' : 'calc(50% - 4px)'}`,
          top: `${h.includes('n') ? -4 : h.includes('s') ? 'calc(100% - 4px)' : 'calc(50% - 4px)'}`,
          cursor: `${h}-resize`,
        }}
        onMouseDown={e => handleMouseDown(e, el.id, 'resize', h)}
      />
    ));
  };

  const renderRotateHandle = (el: LabelElement) => {
    return (
      <div
        className="rotate-handle"
        style={{
          position: 'absolute',
          top: '-20px', left: 'calc(50% - 6px)',
          width: '12px', height: '12px',
          background: '#2563eb',
          border: '1px solid #fff',
          borderRadius: '50%',
          cursor: 'grab',
        }}
        onMouseDown={e => handleMouseDown(e, el.id, 'rotate')}
      />
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: '8px', padding: '8px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['text', 'barcode', 'qr', 'image', 'line', 'rect', 'custom-text', 'price', 'expiry', 'mfg', 'batch', 'weight', 'sku', 'border'] as const).map(type => (
            <button key={type} className="btn btn-sm" onClick={() => addElement(type)} title={`Add ${type}`}>
              {type === 'text' ? 'T' : type === 'barcode' ? '|||' : type === 'qr' ? '□' : type === 'image' ? '🖼' : type === 'line' ? '—' : type === 'rect' ? '▢' : type === 'custom-text' ? 'T⋯' : type === 'price' ? '💲' : type === 'expiry' ? '⏰' : type === 'mfg' ? '🏭' : type === 'batch' ? '📦' : type === 'weight' ? '⚖️' : type === 'sku' ? '#️⃣' : '⬜'}
            </button>
          ))}
        </div>
        <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
        <button className="btn btn-sm" onClick={handleUndo} disabled={historyIndex === 0} title="Undo (Ctrl+Z)">↶</button>
        <button className="btn btn-sm" onClick={handleRedo} disabled={historyIndex >= history.length - 1} title="Redo (Ctrl+Y)">↷</button>
        <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
        {selectedId && (
          <>
            <button className="btn btn-sm" onClick={() => duplicateElement(selectedId!)} title="Duplicate (Ctrl+D)">⎘</button>
            <button className="btn btn-sm btn-danger" onClick={() => deleteElement(selectedId!)} title="Delete (Del)">🗑</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <input type="checkbox" checked={selectedEl?.locked} onChange={e => updateElement(selectedId!, { locked: e.target.checked })} /> Lock
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <input type="checkbox" checked={selectedEl?.visible} onChange={e => updateElement(selectedId!, { visible: e.target.checked })} /> Visible
            </label>
          </>
        )}
        {selectedIds.length > 1 && selectedEl && (
          <>
            <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
            <button className="btn btn-sm" onClick={() => updateSelectedElements({ style: { ...selectedEl.style, align: 'left' } })} title="Align Left">⬛⬜</button>
            <button className="btn btn-sm" onClick={() => updateSelectedElements({ style: { ...selectedEl.style, align: 'center' } })} title="Align Center">⬜⬛⬜</button>
            <button className="btn btn-sm" onClick={() => updateSelectedElements({ style: { ...selectedEl.style, align: 'right' } })} title="Align Right">⬜⬛</button>
            <button className="btn btn-sm" onClick={() => updateSelectedElements({ style: { ...selectedEl.style, align: 'left' } })} title="Align Top">⬆</button>
            <button className="btn btn-sm" onClick={() => updateSelectedElements({ style: { ...selectedEl.style, align: 'center' } })} title="Align Middle">⬜⬆⬜</button>
            <button className="btn btn-sm" onClick={() => updateSelectedElements({ style: { ...selectedEl.style, align: 'center' } })} title="Align Bottom">⬇</button>
            <button className="btn btn-sm" onClick={distributeHorizontally} title="Distribute Horizontally">⬌⬍</button>
            <button className="btn btn-sm" onClick={distributeVertically} title="Distribute Vertically">⬍⬌</button>
            <button className="btn btn-sm" onClick={() => duplicateSelectedElements()} title="Duplicate All (Ctrl+D)">⎘⎘</button>
            <button className="btn btn-sm btn-danger" onClick={deleteSelectedElements} title="Delete All (Del)">🗑🗑</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
          <input type="checkbox" checked={true} onChange={() => {}} /> Grid
        </label>
        <select value={zoom} onChange={e => setZoom(parseInt(e.target.value))} className="field-select" style={{ width: '80px' }}>
          <option value={50}>50%</option>
          <option value={75}>75%</option>
          <option value={100}>100%</option>
          <option value={150}>150%</option>
          <option value={200}>200%</option>
          <option value={300}>300%</option>
        </select>
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '20px', background: '#f0f0f0', overflow: 'auto' }}>
        <div
          ref={canvasRef}
          style={{
            width: `${labelW}mm`,
            height: `${labelH}mm`,
            border: '2px solid #bbb',
            borderRadius: '2mm',
            background: '#fff',
            position: 'relative',
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top center',
            boxSizing: 'border-box',
          }}
          onClick={() => selectElement(null)}
        >
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage: `linear-gradient(#ddd 0.5px, transparent 0.5px), linear-gradient(90deg, #ddd 0.5px, transparent 0.5px)`,
            backgroundSize: `${GRID_SIZE * (zoom / 100) * 3.78}px ${GRID_SIZE * (zoom / 100) * 3.78}px`,
            pointerEvents: 'none',
          }} />

          <div style={{
            position: 'absolute', top: '-12px', left: 0, right: 0, height: '12px',
            background: '#f8f8f8', borderBottom: '1px solid #ddd',
            display: 'flex', fontSize: '8px', color: '#999', pointerEvents: 'none',
          }}>
            {Array.from({ length: labelW + 1 }).map((_, i) => (
              <div key={i} style={{ width: `${100 / labelW}%`, borderLeft: i % 5 === 0 ? '1px solid #999' : '1px solid #ddd', textAlign: 'center', lineHeight: '10px' }}>
                {i % 5 === 0 ? i : ''}
              </div>
            ))}
          </div>
          <div style={{
            position: 'absolute', top: 0, left: '-12px', bottom: 0, width: '12px',
            background: '#f8f8f8', borderRight: '1px solid #ddd',
            display: 'flex', flexDirection: 'column', fontSize: '8px', color: '#999', pointerEvents: 'none',
          }}>
            {Array.from({ length: labelH + 1 }).map((_, i) => (
              <div key={i} style={{ height: `${100 / labelH}%`, borderTop: i % 5 === 0 ? '1px solid #999' : '1px solid #ddd', textAlign: 'right', paddingRight: '2px' }}>
                {i % 5 === 0 ? i : ''}
              </div>
            ))}
          </div>

          {alignmentGuides.x !== undefined && (
            <div style={{
              position: 'absolute',
              left: `${alignmentGuides.x}mm`,
              top: 0,
              bottom: 0,
              width: '1px',
              background: '#2563eb',
              pointerEvents: 'none',
              zIndex: 10,
            }} />
          )}
          {alignmentGuides.y !== undefined && (
            <div style={{
              position: 'absolute',
              top: `${alignmentGuides.y}mm`,
              left: 0,
              right: 0,
              height: '1px',
              background: '#2563eb',
              pointerEvents: 'none',
              zIndex: 10,
            }} />
          )}

          {elements.map(el => (
            <div
              key={el.id}
              style={{
                position: 'absolute',
                left: `${el.x}mm`,
                top: `${el.y}mm`,
                width: `${el.w}mm`,
                height: `${el.h}mm`,
                transform: `rotate(${el.rotation}deg)`,
                transformOrigin: 'center center',
                border: el.locked ? '1px dashed #999' : (selectedId === el.id ? '2px solid #2563eb' : '1px solid transparent'),
                borderRadius: '1px',
                background: el.visible ? 'rgba(255,255,255,0.9)' : 'rgba(200,200,200,0.5)',
                opacity: el.visible ? 1 : 0.4,
                pointerEvents: el.locked ? 'none' : 'auto',
                cursor: el.locked ? 'not-allowed' : 'move',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                fontFamily: el.style.fontFamily,
                fontSize: `${el.style.fontSize}pt`,
                fontWeight: el.style.bold ? '700' : '400',
                fontStyle: el.style.italic ? 'italic' : 'normal',
                textAlign: el.style.align,
                color: el.style.color,
                whiteSpace: 'nowrap',
              }}
              onMouseDown={e => handleMouseDown(e as any, el.id, 'move')}
              onClick={e => { e.stopPropagation(); selectElement(el.id); }}
            >
              {(el.type === 'text' || el.type === 'custom-text' || el.type === 'price' || el.type === 'expiry' || el.type === 'mfg' || el.type === 'batch' || el.type === 'weight' || el.type === 'sku') && el.content}
              {el.type === 'barcode' && <span style={{ fontFamily: 'monospace', fontSize: '6pt' }}>{el.content || '||||||||||'}</span>}
              {el.type === 'qr' && (
                <img
                  src={qrCache.get(el.content) || '/qr-placeholder.png'}
                  alt="QR Code"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onLoad={(e) => {
                    if (!qrCache.has(el.content)) {
                      generateQRCode(el.content, Math.max(el.w, el.h) * 3.78).then(url => {
                        if (qrCache.has(el.content)) return;
                        qrCache.set(el.content, url);
                      });
                    }
                  }}
                />
              )}
              {el.type === 'image' && <img src={el.content || '/logo.png'} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
              {el.type === 'line' && <div style={{ width: '100%', height: '100%', borderBottom: '1px solid #000' }} />}
              {el.type === 'rect' && <div style={{ width: '100%', height: '100%', border: '1px solid #000', borderRadius: '2px' }} />}
              {el.type === 'border' && <div style={{ width: '100%', height: '100%', border: '1px solid #000', borderRadius: '2px' }} />}
              {!el.visible && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '6pt' }}>Hidden</div>}
              {el.locked && <div style={{ position: 'absolute', top: '2px', right: '2px', fontSize: '6pt', color: '#999' }}>🔒</div>}
            </div>
          ))}

          {selectedEl && renderRotateHandle(selectedEl)}
          {selectedEl && renderHandles(selectedEl)}
        </div>
      </div>

      <ElementPropertiesPanel
        selectedEl={selectedEl ?? null}
        showElementProps={showElementProps}
        updateElement={updateElement}
        FONTS={FONTS}
        SYMBOLOGIES={SYMBOLOGIES}
      />

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px', borderTop: '1px solid #e2e8f0' }}>
        <button className="btn" onClick={() => { onSave(elements); }}>Save Template</button>
      </div>
    </div>
  );
}

const qrCache = new Map<string, string>();

async function generateQRCode(text: string, size: number): Promise<string> {
  if (qrCache.has(text)) {
    return qrCache.get(text)!;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const moduleSize = Math.max(2, Math.floor(size / 25));
  ctx.fillStyle = '#000';
  for (let y = 0; y < 25; y++) {
    for (let x = 0; x < 25; x++) {
      const hash = text.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      if ((hash + x * 7 + y * 13) % 3 === 0) ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
    }
    const corners = [[0, 0], [18, 0], [0, 18]];
    for (let i = 0; i < corners.length; i++) {
      const fx = corners[i][0];
      const fy = corners[i][1];
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) if (dy === 0 || dy === 6 || dx === 0 || dx === 6 || (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4)) ctx.fillRect((fx + dx) * moduleSize, (fy + dy) * moduleSize, moduleSize, moduleSize);
    }
    const dataUrl = canvas.toDataURL('image/png');
    qrCache.set(text, dataUrl);
    return dataUrl;
  }
  return '';
}