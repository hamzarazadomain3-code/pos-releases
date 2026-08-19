import { useCallback, useEffect, useState } from 'react';
import type { BestSellerRow, DashboardData, Expense, ProfitLoss, SalesDayRow, StockValuation } from '../../../shared/types';

type Tab = 'dashboard' | 'sales' | 'pl' | 'sellers' | 'valuation' | 'expenses';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

export default function Reports() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const [notice, setNotice] = useState<string | null>(null);

  const [dash, setDash] = useState<DashboardData | null>(null);
  const [sales, setSales] = useState<SalesDayRow[]>([]);
  const [pl, setPl] = useState<ProfitLoss | null>(null);
  const [sellers, setSellers] = useState<BestSellerRow[]>([]);
  const [valuation, setValuation] = useState<StockValuation | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expForm, setExpForm] = useState({ title: '', category: 'Other', amount: '', date: today(), notes: '' });

  const loadAll = useCallback(async () => {
    try {
      const [d, s, p, se, v, e] = await Promise.all([
        window.api.reports.dashboard(),
        window.api.reports.salesReport(from, to),
        window.api.reports.profitLoss(from, to),
        window.api.reports.bestSellers(from, to),
        window.api.reports.stockValuation(),
        window.api.reports.expenses(from, to),
      ]);
      setDash(d);
      setSales(s);
      setPl(p);
      setSellers(se);
      setValuation(v);
      setExpenses(e);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [from, to]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  async function exportTable(name: string, headers: string[], rows: (string | number)[][]) {
    await window.api.exportData.saveCsv(`${name}-${to}.csv`, headers, rows);
  }

  async function exportXlsx(name: string, headers: string[], rows: (string | number)[][]) {
    await window.api.exportData.saveXlsx(`${name}-${to}.xlsx`, [{ name: name.slice(0, 31), headers, rows }]);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reports &amp; Dashboard</h1>
        <div className="toolbar">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-sm" onClick={loadAll}>
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="tabs">
        {(
          [
            ['dashboard', 'Dashboard'],
            ['sales', 'Sales'],
            ['pl', 'Profit & Loss'],
            ['sellers', 'Best Sellers'],
            ['valuation', 'Stock Value'],
            ['expenses', 'Expenses'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'tab-btn active' : 'tab-btn'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && dash && (
        <div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Today's Sales</div>
              <div className="stat-value">{fmt(dash.today_sales)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Today's Bills</div>
              <div className="stat-value">{dash.today_bills}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Udhaar Due</div>
              <div className="stat-value text-warn">{fmt(dash.udhaar_due)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Low Stock Items</div>
              <div className="stat-value text-warn">{dash.low_stock}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Today's Expenses</div>
              <div className="stat-value">{fmt(dash.today_expenses)}</div>
            </div>
          </div>

          <div className="dash-grid">
            <div className="panel">
              <div className="panel-title">Top Products (7 days)</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num">Qty</th>
                      <th className="num">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.top_products.map((t, i) => (
                      <tr key={i}>
                        <td>{t.name}</td>
                        <td className="num">{t.qty}</td>
                        <td className="num">{fmt(t.revenue)}</td>
                      </tr>
                    ))}
                    {dash.top_products.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted center">
                          No sales yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <div className="panel-title">Low Stock Alerts</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num">Stock</th>
                      <th className="num">Alert At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.low_stock_items.map((l) => (
                      <tr key={l.id} className="row-low">
                        <td>{l.name}</td>
                        <td className="num text-warn">{l.stock_qty}</td>
                        <td className="num">{l.low_stock_threshold}</td>
                      </tr>
                    ))}
                    {dash.low_stock_items.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted center">
                          All stock levels are healthy.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-title">Expiring Soon (within {dash.expiry_warning_days} days)</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th className="num">Stock</th>
                    <th>Expiry Date</th>
                    <th className="num">Days Left</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.expiring_soon.map((e) => (
                    <tr key={e.id} className={e.days_left < 0 ? 'row-expired' : e.days_left <= 7 ? 'row-expiring' : ''}>
                      <td>{e.name}</td>
                      <td>{e.category_name ?? '—'}</td>
                      <td className="num">{e.stock_qty}</td>
                      <td>{e.expiry_date}</td>
                      <td className={`num ${e.days_left < 0 ? 'text-warn' : ''}`}>
                        {e.days_left < 0 ? `expired ${Math.abs(e.days_left)}d ago` : `${e.days_left}d`}
                      </td>
                    </tr>
                  ))}
                  {dash.expiring_soon.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted center">
                        No products expiring in this window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-title">Recent Sales</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Time</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.recent_sales.map((s) => (
                    <tr key={s.id}>
                      <td>{s.invoice_no}</td>
                      <td>{s.customer_name ?? '—'}</td>
                      <td>{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td>
                      <td className="num">{fmt(s.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <div>
          <div className="panel">
            <div className="panel-title">
              Sales Report
              <button className="btn btn-sm" onClick={() => window.api.excel.exportSales(from, to)}>
                Export Excel
              </button>
              <button className="btn btn-sm" onClick={() => exportTable('sales-report', ['Date', 'Bills', 'Subtotal', 'Tax', 'Discount', 'Total'], sales.map((s) => [s.day, s.bills, s.subtotal, s.tax, s.discount, s.total]))}>
                Export CSV
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Bills</th>
                    <th className="num">Subtotal</th>
                    <th className="num">Tax</th>
                    <th className="num">Discount</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.day}>
                      <td>{s.day}</td>
                      <td className="num">{s.bills}</td>
                      <td className="num">{fmt(s.subtotal)}</td>
                      <td className="num">{fmt(s.tax)}</td>
                      <td className="num">{fmt(s.discount)}</td>
                      <td className="num">{fmt(s.total)}</td>
                    </tr>
                  ))}
                  {sales.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted center">
                        No sales in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'pl' && pl && (
        <div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Revenue (Sales)</div>
              <div className="stat-value">{fmt(pl.revenue)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Cost of Goods</div>
              <div className="stat-value">-{fmt(pl.cogs)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Gross Profit</div>
              <div className={`stat-value ${pl.gross >= 0 ? 'text-ok' : 'text-warn'}`}>{fmt(pl.gross)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Expenses</div>
              <div className="stat-value">-{fmt(pl.expenses)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Net Profit</div>
              <div className={`stat-value ${pl.net >= 0 ? 'text-ok' : 'text-warn'}`}>{fmt(pl.net)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Udhaar Collected</div>
              <div className="stat-value">{fmt(pl.udhaar_collected)}</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'sellers' && (
        <div className="panel">
          <div className="panel-title">
            Best / Slow Moving Items
            <button className="btn btn-sm" onClick={() => exportXlsx('best-sellers', ['Product', 'Qty', 'Revenue'], sellers.map((s) => [s.name, s.qty, s.revenue]))}>
              Export Excel
            </button>
            <button className="btn btn-sm" onClick={() => exportTable('best-sellers', ['Product', 'Qty', 'Revenue'], sellers.map((s) => [s.name, s.qty, s.revenue]))}>
              Export CSV
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th className="num">Qty Sold</th>
                  <th className="num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{s.name}</td>
                    <td className="num">{s.qty}</td>
                    <td className="num">{fmt(s.revenue)}</td>
                  </tr>
                ))}
                {sellers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted center">
                      No sales in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'valuation' && valuation && (
        <div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Stock Value (Cost)</div>
              <div className="stat-value">{fmt(valuation.cost_value)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Stock Value (Retail)</div>
              <div className="stat-value">{fmt(valuation.retail_value)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active Products</div>
              <div className="stat-value">{valuation.products}</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-title">By Category</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Products</th>
                    <th className="num">Cost</th>
                    <th className="num">Retail</th>
                  </tr>
                </thead>
                <tbody>
                  {valuation.by_category.map((c, i) => (
                    <tr key={i}>
                      <td>{c.name ?? 'Uncategorised'}</td>
                      <td className="num">{c.products}</td>
                      <td className="num">{fmt(c.cost)}</td>
                      <td className="num">{fmt(c.retail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'expenses' && (
        <div>
          <div className="expense-form">
            <input placeholder="Title *" value={expForm.title} onChange={(e) => setExpForm({ ...expForm, title: e.target.value })} />
            <select value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
              {['Other', 'Rent', 'Utilities', 'Salaries', 'Transport', 'Misc'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input type="number" placeholder="Amount *" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
            <input type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} />
            <input placeholder="Notes" value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} />
            <button
              className="btn btn-primary"
              disabled={!expForm.title.trim() || !expForm.amount}
              onClick={async () => {
                await window.api.reports.addExpense({
                  title: expForm.title,
                  category: expForm.category,
                  amount: Number(expForm.amount),
                  expense_date: expForm.date,
                  notes: expForm.notes,
                });
                setExpForm({ title: '', category: 'Other', amount: '', date: today(), notes: '' });
                loadAll();
              }}
            >
              Add
            </button>
          </div>
          <div className="panel">
            <div className="panel-title">Expenses ({from} → {to})
              <button className="btn btn-sm" onClick={() => window.api.excel.exportExpenses(from, to)}>
                Export Excel
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th>Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{e.expense_date}</td>
                      <td>{e.title}</td>
                      <td>{e.category}</td>
                      <td className="num">{fmt(e.amount)}</td>
                      <td className="muted">{e.notes ?? '—'}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={async () => {
                            await window.api.reports.deleteExpense(e.id);
                            loadAll();
                          }}
                        >
                          Del
                        </button>
                      </td>
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted center">
                        No expenses in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}