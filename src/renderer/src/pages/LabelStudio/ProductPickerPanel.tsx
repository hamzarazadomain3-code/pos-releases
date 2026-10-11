import { useRef, useEffect, useMemo } from 'react';
import { KeyboardInput } from '@components/KeyboardInput';
import type { Product } from '@shared/types';
import { formatMoney } from '@utils/currency';
import { useListKeyboard } from '@hooks/useListKeyboard';
import type { LabelElement, ProductOverride } from './types';

interface Props {
  products: Product[];
  filtered: Product[];
  categories: string[];
  selectedProducts: Map<number, number>;
  overrides: Map<number, { name?: string; price?: number; expiry?: string; qty?: number }>;
  search: string;
  setSearch: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  quickFilter: 'none' | 'lowstock' | 'expiring' | 'nobarcode' | 'recent';
  setQuickFilter: (v: 'none' | 'lowstock' | 'expiring' | 'nobarcode' | 'recent') => void;
  searchRef: React.RefObject<HTMLInputElement>;
  productList: { getContainerProps: () => any; getRowProps: (i: number) => any };
  toggleProduct: (id: number) => void;
  setProductQty: (id: number, qty: number) => void;
  selectAll: () => void;
  selectPage: () => void;
  setQtyToStock: () => void;
  setQtyToPurchase: () => void;
  setOverrides: (overrides: Map<number, { name?: string; price?: number; expiry?: string; qty?: number }>) => void;
}

export function ProductPickerPanel({
  products,
  filtered,
  categories,
  selectedProducts,
  overrides,
  search,
  setSearch,
  categoryFilter,
  setCategoryFilter,
  quickFilter,
  setQuickFilter,
  searchRef,
  productList,
  toggleProduct,
  setProductQty,
  selectAll,
  selectPage,
  setQtyToStock,
  setQtyToPurchase,
  setOverrides,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const fmtExpiry = (d?: string | null): string => {
    if (!d) return '';
    const parts = d.slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
  };

  const hasOverride = (id: number) => overrides.has(id);

  const openOverrideModal = (id: number) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    const ov = overrides.get(id) || {};
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div className="modal" style="width:400px;background:white;border-radius:8px;padding:20px;max-height:80vh;overflow:auto">
        <h3 style="margin:0 0 16px">Override: ${p.name}</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          <label className="field"><span>Name</span><input type="text" id="ov-name" value="${(ov.name || p.name).replace(/"/g, '"')}" /></label>
          <label className="field"><span>Price</span><input type="number" step="0.01" id="ov-price" value="${ov.price ?? p.sale_price}" /></label>
          <label className="field"><span>Expiry (YYYY-MM-DD)</span><input type="date" id="ov-expiry" value="${ov.expiry || p.expiry_date || ''}" /></label>
          <label className="field"><span>Qty for this print</span><input type="number" min="1" id="ov-qty" value="${ov.qty || selectedProducts.get(id) || 1}" /></label>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button className="btn" id="ov-cancel">Cancel</button>
            <button className="btn btn-primary" id="ov-save">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const cleanup = () => { document.body.removeChild(modal); };
    modal.querySelector('#ov-cancel')!.addEventListener('click', cleanup);
    modal.querySelector('#ov-save')!.addEventListener('click', () => {
      const name = (modal.querySelector('#ov-name') as HTMLInputElement).value;
      const price = parseFloat((modal.querySelector('#ov-price') as HTMLInputElement).value);
      const expiry = (modal.querySelector('#ov-expiry') as HTMLInputElement).value;
      const qty = parseInt((modal.querySelector('#ov-qty') as HTMLInputElement).value, 10);
      const next = new Map(overrides);
      const newOv: { name?: string; price?: number; expiry?: string; qty?: number } = {};
      if (name !== p.name) newOv.name = name;
      if (price !== p.sale_price) newOv.price = price;
      if (expiry !== p.expiry_date) newOv.expiry = expiry || undefined;
      if (qty !== (selectedProducts.get(id) || 1)) newOv.qty = qty;
      if (Object.keys(newOv).length) next.set(id, newOv);
      else next.delete(id);
      setOverrides(next);
      cleanup();
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });
  };

  return (
    <div className="panel product-picker" {...productList.getContainerProps()}>
      <div className="panel-header">
        <h3>Products ({filtered.length})</h3>
        <div className="panel-actions">
          <button className="btn btn-sm" onClick={selectPage} title="Select Page">Page</button>
          <button className="btn btn-sm" onClick={selectAll} title="Select All">All</button>
          <button className="btn btn-sm" onClick={setQtyToStock} title="Labels = Stock Qty">Stock</button>
          <button className="btn btn-sm" onClick={setQtyToPurchase} title="Labels = Purchase Qty">PO Qty</button>
        </div>
      </div>

      <div className="picker-toolbar">
        <input
          ref={searchRef}
          className="search-input"
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="field-select"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{ minWidth: '140px' }}
        >
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="field-select"
          value={quickFilter}
          onChange={e => setQuickFilter(e.target.value as any)}
          style={{ minWidth: '140px' }}
        >
          <option value="none">Quick Filters</option>
          <option value="lowstock">Low Stock</option>
          <option value="expiring">Expiring Soon</option>
          <option value="nobarcode">No Barcode</option>
          <option value="recent">Recent</option>
        </select>
      </div>

      <div className="result-list" ref={listRef} tabIndex={0}>
        {filtered.map((p, i) => {
          const sel = selectedProducts.get(p.id);
          const qty = sel || 0;
          const ov = overrides.get(p.id);
          return (
            <label
              key={p.id}
              {...productList.getRowProps(i)}
              className={`result-item ${sel ? 'selected' : ''} ${hasOverride(p.id) ? 'has-override' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 8px', borderRadius: '4px' }}
              onDoubleClick={() => openOverrideModal(p.id)}
            >
              <input
                type="checkbox"
                checked={!!sel}
                onChange={() => toggleProduct(p.id)}
                onClick={e => e.stopPropagation()}
                style={{ width: '16px', height: '16px', flexShrink: 0 }}
              />
              <span className="result-name" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <span className="result-meta" style={{ fontSize: '11px', color: '#666', whiteSpace: 'nowrap' }}>
                {formatMoney(p.sale_price)}
                {p.barcode ? ` • ${p.barcode}` : p.sku ? ` • ${p.sku}` : ' • no barcode'}
                {p.expiry_date ? ` • exp ${fmtExpiry(p.expiry_date)}` : ''}
                {p.stock_qty > 0 ? ` • ${Number(p.stock_qty.toFixed(3))} in stock` : ' • out of stock'}
              </span>
              <KeyboardInput
                type="text"
                decimals={false}
                value={qty}
                onChange={e => setProductQty(p.id, Math.max(0, Math.min(999, parseInt(e.target.value) || 0)))}
                style={{ width: '50px', textAlign: 'center' }}
                onClick={e => e.stopPropagation()}
              />
              <button
                className="btn btn-xs"
                onClick={e => { e.stopPropagation(); openOverrideModal(p.id); }}
                style={{ padding: '2px 8px', fontSize: '10px' }}
                title="Override data"
              >
                {hasOverride(p.id) ? '✎' : '⋯'}
              </button>
            </label>
          );
        })}
        {filtered.length === 0 && <div className="muted center pad">No products found</div>}
      </div>
    </div>
  );
}