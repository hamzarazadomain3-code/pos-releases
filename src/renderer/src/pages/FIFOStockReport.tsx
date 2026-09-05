import { useCallback, useEffect, useState } from 'react';
import type { Product } from '../../../shared/types';

const fmt = (n: number) => n?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '0';

interface BatchRow {
  product_id: number;
  product_name: string;
  batch_id: number;
  batch_number: string;
  total_qty: number;
  available_qty: number;
  unit_cost: number;
  total_value: number;
}

export default function FIFOStockReport() {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [filterProduct, setFilterProduct] = useState<number | ''>('');
  const [fifoEnabled, setFifoEnabled] = useState(true);
  const [fifoStrict, setFifoStrict] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [report, enabled, strict, prods] = await Promise.all([
        window.api.fifo.stockReport(filterProduct || undefined),
        window.api.fifo.isEnabled(),
        window.api.fifo.isStrict(),
        window.api.inventory.list(),
      ]);
      setRows(report as BatchRow[]);
      setFifoEnabled(enabled);
      setFifoStrict(strict);
      setProducts(prods);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterProduct]);

  useEffect(() => { load(); }, [load]);

  // Group by product
  const grouped = rows.reduce<Record<number, { name: string; batches: BatchRow[]; totalAvail: number; totalValue: number }>>((acc, r) => {
    if (!acc[r.product_id]) acc[r.product_id] = { name: r.product_name, batches: [], totalAvail: 0, totalValue: 0 };
    acc[r.product_id].batches.push(r);
    acc[r.product_id].totalAvail += r.available_qty;
    acc[r.product_id].totalValue += r.total_value;
    return acc;
  }, {});

  const grandTotal = Object.values(grouped).reduce((s, g) => s + g.totalValue, 0);

  return (
    <div className="page">
      <div className="page-header">
        <h1>FIFO Stock Report</h1>
        <div className="row-btns">
          <button className="btn btn-sm" onClick={load}>Refresh</button>
        </div>
      </div>

      {/* Status badges */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <span className={`badge ${fifoEnabled ? 'badge-ok' : 'badge-warn'}`}>
          FIFO: {fifoEnabled ? 'ON' : 'OFF'}
        </span>
        <span className="badge">
          Strict Mode: {fifoStrict ? 'ON' : 'OFF'}
        </span>
        <span className="badge">
          Total Value: Rs {fmt(grandTotal)}
        </span>
      </div>

      {/* Filter */}
      <div className="form-row" style={{ marginBottom: 12 }}>
        <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All Products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="muted center">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="muted center">No batch data found. FIFO tracking requires product batches from purchases.</div>
      ) : (
        Object.entries(grouped).map(([pid, group]) => (
          <div key={pid} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>{group.name}</h3>
              <span className="badge badge-ok">
                {fmt(group.totalAvail)} avail · Rs {fmt(group.totalValue)}
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch #</th>
                  <th>Total Qty</th>
                  <th>Available</th>
                  <th>Allocated</th>
                  <th>Unit Cost</th>
                  <th>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {group.batches.map((b) => (
                  <tr key={b.batch_id} style={{ opacity: b.available_qty <= 0 ? 0.5 : 1 }}>
                    <td>{b.batch_number}</td>
                    <td>{fmt(b.total_qty)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(b.available_qty)}</td>
                    <td>{fmt(b.total_qty - b.available_qty)}</td>
                    <td>Rs {fmt(b.unit_cost)}</td>
                    <td>Rs {fmt(b.total_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
