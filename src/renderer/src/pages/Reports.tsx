import { useCallback, useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  CustomerAnalysisResult,
  DailyClosingResult,
  Expense,
  FinancialReportResult,
  InventoryAnalysisResult,
  ProductPerformanceResult,
  SalesAnalysisResult,
  TaxReportResult,
} from '../../../shared/types';

type Tab = 'sales' | 'products' | 'customers' | 'inventory' | 'financial' | 'tax' | 'closing' | 'expenses';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
const today = (): string => new Date().toISOString().slice(0, 10);

const PIE_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#a4de6c'];

export default function Reports() {
  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [closingDate, setClosingDate] = useState(today());
  const [notice, setNotice] = useState<string | null>(null);

  const [salesAnalysis, setSalesAnalysis] = useState<SalesAnalysisResult | null>(null);
  const [productPerf, setProductPerf] = useState<ProductPerformanceResult | null>(null);
  const [customerAnalysis, setCustomerAnalysis] = useState<CustomerAnalysisResult | null>(null);
  const [inventoryAnalysis, setInventoryAnalysis] = useState<InventoryAnalysisResult | null>(null);
  const [financial, setFinancial] = useState<FinancialReportResult | null>(null);
  const [tax, setTax] = useState<TaxReportResult | null>(null);
  const [closing, setClosing] = useState<DailyClosingResult | null>(null);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expForm, setExpForm] = useState({ title: '', category: 'Other', amount: '', date: today(), notes: '' });

  const fmt = (n: number | null | undefined): string =>
    (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  const loadTab = useCallback(async () => {
    setNotice(null);
    try {
      switch (tab) {
        case 'sales':
          setSalesAnalysis(await window.api.reports.getSalesAnalysis(from, to));
          break;
        case 'products':
          setProductPerf(await window.api.reports.getProductPerformance(from, to));
          break;
        case 'customers':
          setCustomerAnalysis(await window.api.reports.getCustomerAnalysis());
          break;
        case 'inventory':
          setInventoryAnalysis(await window.api.reports.getInventoryAnalysis());
          break;
        case 'financial':
          setFinancial(await window.api.reports.getFinancialReport(from, to));
          break;
        case 'tax':
          setTax(await window.api.reports.getTaxReport(from, to));
          break;
        case 'closing':
          setClosing(await window.api.reports.getDailyClosing(closingDate));
          break;
        case 'expenses':
          setExpenses(await window.api.reports.expenses(from, to));
          break;
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [tab, from, to, closingDate]);

  useEffect(() => {
    loadTab();
  }, [loadTab]);

  async function exportPdf(reportType: string, data: unknown) {
    const path = await window.api.reports.exportReportPDF(reportType, data);
    if (path) setNotice(`PDF saved: ${path}`);
  }

  async function exportXlsx(name: string, headers: string[], rows: (string | number | null)[][]) {
    await window.api.exportData.saveXlsx(`${name}-${to}.xlsx`, [{ name: name.slice(0, 31), headers, rows }]);
  }

  function ExportButtons(props: {
    reportType: string;
    data: unknown;
    xlsx?: { name: string; headers: string[]; rows: (string | number | null)[][] } | null;
  }) {
    return (
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
        <button className="btn btn-sm" onClick={() => exportPdf(props.reportType, props.data)}>
          📄 PDF
       </button>
        {props.xlsx && (
          <button
            className="btn btn-sm"
            onClick={() => exportXlsx(props.xlsx!.name, props.xlsx!.headers, props.xlsx!.rows)}
          >
            📊 Excel
         </button>
        )}
     </span>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reports & Analytics</h1>
        <div className="toolbar">
          {tab !== 'closing' && tab !== 'customers' && tab !== 'inventory' && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="muted">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
          {tab === 'closing' && (
            <input
              type="date"
              value={closingDate}
              onChange={(e) => setClosingDate(e.target.value)}
            />
          )}
          <button className="btn btn-sm" onClick={loadTab}>
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
            ['sales', 'Sales'],
            ['products', 'Products'],
            ['customers', 'Customers'],
            ['inventory', 'Inventory'],
            ['financial', 'Financial'],
            ['tax', 'Tax (FBR)'],
            ['closing', 'Daily Closing'],
            ['expenses', 'Expenses'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            className={tab === k ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setTab(k)}
          >
            {label}
         </button>
        ))}
     </div>

      {/* ============ SALES ============ */}
      {tab === 'sales' && salesAnalysis && (
        <div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Total Sales</div>
              <div className="stat-value">{fmt(salesAnalysis.summary.total_sales)}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Bill Count</div>
              <div className="stat-value">{salesAnalysis.summary.bill_count}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Avg Bill</div>
              <div className="stat-value">{fmt(salesAnalysis.summary.avg_bill)}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Total Discount</div>
              <div className="stat-value">{fmt(salesAnalysis.summary.total_discount)}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Total Tax</div>
              <div className="stat-value">{fmt(salesAnalysis.summary.total_tax)}</div>
           </div>
         </div>

          <div className="panel">
            <div className="panel-title">
              Payment Mode Breakdown
              <ExportButtons
                reportType="sales"
                data={salesAnalysis}
                xlsx={{
                  name: 'sales-analysis',
                  headers: ['Mode', 'Total', '%'],
                  rows: salesAnalysis.paymentBreakdown.map((r) => [r.mode, r.total, `${r.percentage}%`]),
                }}
              />
           </div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={salesAnalysis.paymentBreakdown}
                    dataKey="total"
                    nameKey="mode"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label
                  >
                    {salesAnalysis.paymentBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                 </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
               </PieChart>
             </ResponsiveContainer>
           </div>
         </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-title">Daily Sales Trend</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={salesAnalysis.dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="total" stroke="#8884d8" strokeWidth={2} name="Sales (Rs)" />
               </LineChart>
             </ResponsiveContainer>
           </div>
         </div>
       </div>
      )}

      {/* ============ PRODUCTS ============ */}
      {tab === 'products' && productPerf && (
        <div>
          <div className="panel">
            <div className="panel-title">
              Top 20 Products by Revenue
              <ExportButtons
                reportType="products"
                data={productPerf}
                xlsx={{
                  name: 'product-performance',
                  headers: ['Product', 'Category', 'Qty Sold', 'Revenue', 'Margin %', '% of Total'],
                  rows: productPerf.topProducts.map((p) => [
                    p.name,
                    p.category ?? '',
                    p.qty_sold,
                    p.revenue,
                    `${p.profit_margin_pct}%`,
                    `${p.revenue_pct}%`,
                  ]),
                }}
              />
           </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th className="num">Qty</th>
                    <th className="num">Revenue</th>
                    <th className="num">Margin</th>
                    <th className="num">% of Total</th>
                 </tr>
               </thead>
                <tbody>
                  {productPerf.topProducts.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.category ?? '—'}</td>
                      <td className="num">{fmt(p.qty_sold)}</td>
                      <td className="num">{fmt(p.revenue)}</td>
                      <td className="num">
                        <span
                          className={`badge ${
                            p.profit_margin_pct >= 20
                              ? 'badge-ok'
                              : p.profit_margin_pct >= 5
                              ? 'badge-warn'
                              : 'badge-bad'
                          }`}
                        >
                          {fmt(p.profit_margin_pct)}%
                       </span>
                     </td>
                      <td className="num">{fmt(p.revenue_pct)}%</td>
                   </tr>
                  ))}
                  {productPerf.topProducts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted center">
                        No sales in this period
                     </td>
                   </tr>
                  )}
               </tbody>
             </table>
           </div>
         </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-title">Sales by Category</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={productPerf.categoryAnalysis}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                  <Bar dataKey="revenue" fill="#8884d8" name="Revenue (Rs)" />
                  <Bar dataKey="qty_sold" fill="#82ca9d" name="Units Sold" />
               </BarChart>
             </ResponsiveContainer>
           </div>
         </div>

          {productPerf.slowMovers.length > 0 && (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-title">Slow Movers ({'>'} 30 days no sale</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th className="num">Stock</th>
                      <th className="num">Cost</th>
                      <th className="num">Price</th>
                      <th>Last Sale</th>
                      <th className="num">Days No Sale</th>
                   </tr>
                 </thead>
                  <tbody>
                    {productPerf.slowMovers.map((p) => (
                      <tr key={p.id} className="row-low">
                        <td>{p.name}</td>
                        <td>{p.category ?? '—'}</td>
                        <td className="num">{fmt(p.stock_qty)}</td>
                        <td className="num">{fmt(p.cost_price)}</td>
                        <td className="num">{fmt(p.sale_price)}</td>
                        <td>{p.last_sale_date ?? '—'}</td>
                        <td className="num text-warn">{p.days_no_sale ?? '—'}</td>
                     </tr>
                    ))}
                 </tbody>
               </table>
             </div>
           </div>
          )}
       </div>
      )}

      {/* ============ CUSTOMERS ============ */}
      {tab === 'customers' && customerAnalysis && (
        <div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Total Customers</div>
              <div className="stat-value">{customerAnalysis.udhaarSummary.total_customers}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">With Balance</div>
              <div className="stat-value text-warn">{customerAnalysis.udhaarSummary.with_balance}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Outstanding</div>
              <div className="stat-value text-warn">{fmt(customerAnalysis.udhaarSummary.total_outstanding)}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Avg Balance</div>
              <div className="stat-value">{fmt(customerAnalysis.udhaarSummary.avg_balance)}</div>
           </div>
         </div>

          <div className="panel">
            <div className="panel-title">
              Top Customers by Spending
              <ExportButtons
                reportType="customers"
                data={customerAnalysis}
                xlsx={{
                  name: 'customer-analysis',
                  headers: ['Name', 'Phone', 'Purchases', 'Total Spent', 'Avg', 'Segment'],
                  rows: customerAnalysis.topCustomers.map((c) => [
                    c.name,
                    c.phone ?? '',
                    c.purchase_count,
                    c.total_spent,
                    Math.round(c.avg_purchase),
                    c.segment,
                  ]),
                }}
              />
           </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th className="num">Purchases</th>
                    <th className="num">Total Spent</th>
                    <th className="num">Avg</th>
                    <th>Segment</th>
                 </tr>
               </thead>
                <tbody>
                  {customerAnalysis.topCustomers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.phone ?? '—'}</td>
                      <td className="num">{c.purchase_count}</td>
                      <td className="num">{fmt(c.total_spent)}</td>
                      <td className="num">{fmt(c.avg_purchase)}</td>
                      <td>
                        <span className={`badge badge-${c.segment.toLowerCase()}`}>{c.segment}</span>
                     </td>
                   </tr>
                  ))}
               </tbody>
             </table>
           </div>
         </div>

          {customerAnalysis.udhaarOverdue.length > 0 && (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-title">⚠ Overdue Udhaar ({'>'} 30 days</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th className="num">Outstanding</th>
                      <th>Last Purchase</th>
                      <th className="num">Days</th>
                   </tr>
                 </thead>
                  <tbody>
                    {customerAnalysis.udhaarOverdue.map((c) => (
                      <tr key={c.id} className="row-low">
                        <td>{c.name}</td>
                        <td>{c.phone ?? '—'}</td>
                        <td className="num text-warn">{fmt(c.balance)}</td>
                        <td>{c.last_purchase ?? '—'}</td>
                        <td className="num text-warn">{c.days_since_purchase ?? '—'}</td>
                     </tr>
                    ))}
                 </tbody>
               </table>
             </div>
           </div>
          )}
       </div>
      )}

      {/* ============ INVENTORY ============ */}
      {tab === 'inventory' && inventoryAnalysis && (
        <div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Total SKUs</div>
              <div className="stat-value">{inventoryAnalysis.stockSummary.total_skus}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Stock Value (cost</div>
              <div className="stat-value">{fmt(inventoryAnalysis.stockSummary.total_value)}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Out of Stock</div>
              <div className="stat-value text-warn">{inventoryAnalysis.stockSummary.out_of_stock}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Below Minimum</div>
              <div className="stat-value text-warn">{inventoryAnalysis.stockSummary.below_minimum}</div>
           </div>
         </div>

          <div className="panel">
            <div className="panel-title">Product Velocity</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Stock</th>
                    <th>Velocity</th>
                    <th>Last Sale</th>
                    <th className="num">Days No Sale</th>
                 </tr>
               </thead>
                <tbody>
                  {inventoryAnalysis.turnoverAnalysis.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="num">{fmt(p.stock_qty)}</td>
                      <td>
                        <span
                          className={`velocity velocity-${p.velocity
                            .toLowerCase()
                            .replace(' ', '-')}`}
                        >
                          {p.velocity}
                       </span>
                     </td>
                      <td>{p.last_sale_date ?? '—'}</td>
                      <td className="num">{p.days_no_sale ?? '—'}</td>
                   </tr>
                  ))}
               </tbody>
             </table>
           </div>
            <ExportButtons reportType="inventory" data={inventoryAnalysis} />
         </div>

          {inventoryAnalysis.expiryAlert.filter((e) => e.status !== 'OK').length > 0 && (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-title">Expiry Alerts</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th className="num">Stock</th>
                      <th>Expiry</th>
                      <th className="num">Days Left</th>
                      <th>Status</th>
                   </tr>
                 </thead>
                  <tbody>
                    {inventoryAnalysis.expiryAlert
                      .filter((e) => e.status !== 'OK')
                      .map((e) => (
                        <tr key={e.id} className={`row-${e.status.toLowerCase()}`}>
                          <td>{e.name}</td>
                          <td>{e.category ?? '—'}</td>
                          <td className="num">{fmt(e.stock_qty)}</td>
                          <td>{e.expiry_date}</td>
                          <td className="num">{e.days_until_expiry}</td>
                          <td>
                            <span className={`badge badge-${e.status.toLowerCase()}`}>{e.status}</span>
                         </td>
                       </tr>
                      ))}
                 </tbody>
               </table>
             </div>
           </div>
          )}
       </div>
      )}

      {/* ============ FINANCIAL ============ */}
      {tab === 'financial' && financial && (
        <div>
          <div className="pnl-statement">
            <div className="pnl-row">
              <span className="label">Gross Sales</span>
              <span className="value">{fmt(financial.pnl.gross_sales)}</span>
           </div>
            <div className="pnl-row">
              <span className="label">− Discounts</span>
              <span className="value text-warn">−{fmt(financial.pnl.discounts)}</span>
           </div>
            <div className="pnl-row total">
              <span className="label">Net Sales</span>
              <span className="value">{fmt(financial.pnl.net_sales)}</span>
           </div>
            <div className="pnl-row">
              <span className="label">− Cost of Goods</span>
              <span className="value text-warn">−{fmt(financial.pnl.cogs)}</span>
           </div>
            <div className="pnl-row total">
              <span className="label">
                Gross Profit ({fmt(financial.margins.gross_margin_pct)}%)
             </span>
              <span className="value text-ok">{fmt(financial.pnl.gross_profit)}</span>
           </div>
            <div className="pnl-row">
              <span className="label">− Tax Paid</span>
              <span className="value text-warn">−{fmt(financial.pnl.tax_paid)}</span>
           </div>
            <div className="pnl-row">
              <span className="label">− Expenses</span>
              <span className="value text-warn">−{fmt(financial.pnl.expenses)}</span>
           </div>
            <div className="pnl-row final">
              <span className="label">
                NET PROFIT ({fmt(financial.margins.net_margin_pct)}%)
             </span>
              <span
                className={`value ${
                  financial.pnl.net_profit >= 0 ? 'text-ok' : 'text-warn'
                }`}
              >
                {fmt(financial.pnl.net_profit)}
             </span>
           </div>
         </div>
          <div style={{ marginTop: 12 }}>
            <ExportButtons reportType="financial" data={financial} />
         </div>
       </div>
      )}

      {/* ============ TAX ============ */}
      {tab === 'tax' && tax && (
        <div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Taxable Sales</div>
              <div className="stat-value">{fmt(tax.taxSummary.taxable_sales)}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Tax Collected</div>
              <div className="stat-value">{fmt(tax.taxSummary.tax_collected)}</div>
           </div>
            <div className="stat-card">
              <div className="stat-label">Transactions</div>
              <div className="stat-value">{tax.taxSummary.transaction_count}</div>
           </div>
         </div>

          <div className="panel">
            <div className="panel-title">
              Tax Breakdown by Category (FBR 17% GST inclusive)
              <ExportButtons
                reportType="tax"
                data={tax}
                xlsx={{
                  name: 'tax-report',
                  headers: ['Category', 'Sales (Rs)', 'Est. GST 17% (Rs)'],
                  rows: tax.taxByCategory.map((t) => [
                    t.category ?? 'Uncategorised',
                    t.sales,
                    Math.round(t.estimated_gst_17pct),
                  ]),
                }}
              />
           </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Sales (Rs</th>
                    <th className="num">Est. GST 17% (Rs</th>
                 </tr>
               </thead>
                <tbody>
                  {tax.taxByCategory.map((t) => (
                    <tr key={t.category ?? 'uncat'}>
                      <td>{t.category ?? 'Uncategorised'}</td>
                      <td className="num">{fmt(t.sales)}</td>
                      <td className="num">{fmt(t.estimated_gst_17pct)}</td>
                   </tr>
                  ))}
                  {tax.taxByCategory.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted center">
                        No sales in this period
                     </td>
                   </tr>
                  )}
               </tbody>
             </table>
           </div>
            <div className="alert info">
              <strong>📋 For Tax Filing</strong>
              <p>Save this report quarterly for GST/Sales Tax filing. Exported Excel file can be submitted to FBR directly</p>
           </div>
         </div>
       </div>
      )}

      {/* ============ DAILY CLOSING ============ */}
      {tab === 'closing' && closing && (
        <div>
          <div className="closing-card">
            <h3>Sales Summary — {closing.date}</h3>
            <div className="closing-row">
              <span>Total Sales</span>
              <span>{fmt(closing.total_sales)}</span>
           </div>
            <div className="closing-row">
              <span>Total Bills</span>
              <span>{closing.bill_count}</span>
           </div>
         </div>

          <div className="closing-card">
            <h3>By Payment Mode</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th className="num">Amount</th>
                 </tr>
               </thead>
                <tbody>
                  {closing.by_mode.map((m) => (
                    <tr key={m.mode}>
                      <td>{m.mode}</td>
                      <td className="num">{fmt(m.total)}</td>
                   </tr>
                  ))}
                  {closing.by_mode.length === 0 && (
                    <tr>
                      <td colSpan={2} className="muted center">
                        No sales on this date
                     </td>
                   </tr>
                  )}
               </tbody>
             </table>
           </div>
         </div>

          <div className="closing-card">
            <h3>Cash Reconciliation</h3>
            <div className="closing-row">
              <span>Expected Cash</span>
              <span>{fmt(closing.expected_cash)}</span>
           </div>
            <div className="closing-row">
              <span>Expenses</span>
              <span>−{fmt(closing.expenses)}</span>
           </div>
            <div className="closing-row total">
              <span>Expected Net Cash</span>
              <span>{fmt(closing.expected_cash - closing.expenses)}</span>
           </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              Count actual cash drawer and record in the Shift Close screen for variance tracking.
           </p>
            <ExportButtons reportType="closing" data={closing} />
         </div>
       </div>
      )}

      {/* ============ EXPENSES ============ */}
      {tab === 'expenses' && (
        <div>
          <div className="expense-form">
            <input
              placeholder="Title *"
              value={expForm.title}
              onChange={(e) => setExpForm({ ...expForm, title: e.target.value })}
            />
            <select
              value={expForm.category}
              onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
            >
              {['Other', 'Rent', 'Utilities', 'Salaries', 'Transport', 'Misc'].map((c) => (
                <option key={c}>{c}</option>
              ))}
           </select>
            <input
              type="number"
              placeholder="Amount *"
              value={expForm.amount}
              onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })}
            />
            <input
              type="date"
              value={expForm.date}
              onChange={(e) => setExpForm({ ...expForm, date: e.target.value })}
            />
            <input
              placeholder="Notes"
              value={expForm.notes}
              onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })}
            />
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
                loadTab();
              }}
            >
              Add
           </button>
         </div>
          <div className="panel">
            <div className="panel-title">
              Expenses ({from} → {to})
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
                            loadTab();
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
                        No expenses in this period
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
