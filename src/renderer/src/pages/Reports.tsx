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
  AlertRow,
  DailyInventoryRow,
  MonthlyInventoryRow,
  SupplierMetricRow,
  WeeklyInventoryRow,
  InventoryReportRow,
  CategoryProfitRow,
  LowProfitRow,
  WorstProductRow,
  BreakEvenRow,
  ProductProfitRow,
  ProductPurchaseSummaryRow,
  DailySnapshotResult,
} from '../../../shared/types';

type Tab =
  | 'sales'
  | 'products'
  | 'customers'
  | 'inventory'
  | 'financial'
  | 'tax'
  | 'closing'
  | 'expenses'
  | 'alerts'
  | 'profitability';

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

  // ── v1.8.0 state ──
  const [invSubTab, setInvSubTab] = useState<'purchaseHistory' | 'daily' | 'weekly' | 'monthly' | 'supplierMetrics'>('daily');
  const [dailyInv, setDailyInv] = useState<DailyInventoryRow[]>([]);
  const [weeklyInv, setWeeklyInv] = useState<WeeklyInventoryRow[]>([]);
  const [monthlyInv, setMonthlyInv] = useState<MonthlyInventoryRow[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<InventoryReportRow[]>([]);
  const [supplierMetrics, setSupplierMetrics] = useState<SupplierMetricRow[]>([]);

  const [profitSubTab, setProfitSubTab] = useState<'daily' | 'weekly' | 'monthly' | 'category' | 'breakEven' | 'lowProfit' | 'topProducts' | 'worstProducts'>('daily');
  const [profitData, setProfitData] = useState<ProductProfitRow[]>([]);
  const [categoryProfit, setCategoryProfit] = useState<CategoryProfitRow[]>([]);
  const [lowProfitData, setLowProfitData] = useState<LowProfitRow[]>([]);
  const [worstProducts, setWorstProducts] = useState<WorstProductRow[]>([]);
  const [breakEven, setBreakEven] = useState<BreakEvenRow[]>([]);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [snapshotResult, setSnapshotResult] = useState<DailySnapshotResult | null>(null);

  const fmt = (n: number | null | undefined): string =>
    (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  // ── v1.8.0 Profitability sub-tab loader ──
  const loadProfitSubTab = useCallback(async () => {
    try {
      switch (profitSubTab) {
        case 'daily':
          setProfitData(await window.api.profitability.daily(today()));
          break;
        case 'weekly':
          const ws = new Date();
          ws.setDate(ws.getDate() - 7);
          const we = new Date();
          setProfitData(await window.api.profitability.weekly(
            ws.toISOString().split('T')[0], we.toISOString().split('T')[0]
          ));
          break;
        case 'monthly':
          const now = new Date();
          setProfitData(await window.api.profitability.monthly(now.getFullYear(), now.getMonth() + 1));
          break;
        case 'category':
          const cs = new Date();
          cs.setDate(cs.getDate() - 30);
          const ce = new Date();
          setCategoryProfit(await window.api.profitability.category(
            cs.toISOString().split('T')[0], ce.toISOString().split('T')[0]
          ));
          break;
        case 'breakEven':
          setBreakEven(await window.api.profitability.breakEven());
          break;
        case 'lowProfit':
          setLowProfitData(await window.api.profitability.lowProfit());
          break;
        case 'topProducts':
          setProfitData(await window.api.profitability.topProfit());
          break;
        case 'worstProducts':
          setWorstProducts(await window.api.profitability.worstPerforming());
          break;
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [profitSubTab]);

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
        // ── v1.8.0 ──
        case 'alerts':
          setAlerts(await window.api.alerts.getAll());
          break;
        case 'profitability':
          await loadProfitSubTab();
          break;
      }

      // Inventory sub-tabs
      if (invSubTab === 'daily') {
        setDailyInv(await window.api.inventoryReports.dailyInventory(today()));
      } else if (invSubTab === 'weekly') {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        const weekEnd = new Date();
        setWeeklyInv(await window.api.inventoryReports.weeklyInventory(
          weekStart.toISOString().split('T')[0],
          weekEnd.toISOString().split('T')[0]
        ));
      } else if (invSubTab === 'monthly') {
        const now = new Date();
        setMonthlyInv(await window.api.inventoryReports.monthlyInventory(now.getFullYear(), now.getMonth() + 1));
      } else if (invSubTab === 'purchaseHistory') {
        setPurchaseHistory(await window.api.inventoryReports.purchaseHistory(undefined, { start: from, end: to }));
      } else if (invSubTab === 'supplierMetrics') {
        setSupplierMetrics(await window.api.inventoryReports.supplierMetrics());
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [tab, from, to, closingDate, invSubTab, profitSubTab]);

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
           {tab !== 'closing' && tab !== 'customers' && tab !== 'inventory' && tab !== 'alerts' && tab !== 'profitability' && (
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
             ['alerts', 'Alerts'],
             ['profitability', 'Profitability'],
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
       {tab === 'inventory' && (
        <div>
          {/* ── v1.8.0 Sub-tabs ── */}
          <div className="tabs" style={{ marginBottom: 16 }}>
            {(
              [
                ['daily', 'Daily'],
                ['weekly', 'Weekly'],
                ['monthly', 'Monthly'],
                ['purchaseHistory', 'Purchase History'],
                ['supplierMetrics', 'Supplier Metrics'],
              ] as [typeof invSubTab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                className={invSubTab === k ? 'tab-btn active' : 'tab-btn'}
                onClick={() => setInvSubTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Daily Inventory ── */}
          {invSubTab === 'daily' && dailyInv.length > 0 && (
            <div>
              <div className="panel">
                <div className="panel-title">Today's Daily Inventory</div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Unit</th>
                        <th className="num">Opening</th>
                        <th className="num">Purchases</th>
                        <th className="num">Sales</th>
                        <th className="num">Closing</th>
                        <th className="num">Variance</th>
                        <th className="num">Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyInv.map((r) => (
                        <tr key={r.product_id}>
                          <td>{r.product_name}</td>
                          <td>{r.unit_name || '—'}</td>
                          <td className="num">{fmt(r.opening_qty)}</td>
                          <td className="num">{fmt(r.purchases_qty)}</td>
                          <td className="num">{fmt(r.sales_qty)}</td>
                          <td className="num">{fmt(r.closing_qty)}</td>
                          <td className="num" style={{ color: r.variance_qty !== 0 ? '#ef4444' : '#22c55e' }}>
                            {r.variance_qty !== 0 ? fmt(r.variance_qty) : '0'}
                          </td>
                          <td className="num">{fmt(r.stock_qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ExportButtons
                  reportType="daily-inventory"
                  data={dailyInv}
                  xlsx={{
                    name: 'daily-inventory',
                    headers: ['Product', 'Unit', 'Opening', 'Purchases', 'Sales', 'Closing', 'Variance', 'Stock'],
                    rows: dailyInv.map((r) => [
                      r.product_name, r.unit_name || '', r.opening_qty, r.purchases_qty,
                      r.sales_qty, r.closing_qty, r.variance_qty, r.stock_qty
                    ]),
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Weekly Inventory ── */}
          {invSubTab === 'weekly' && weeklyInv.length > 0 && (
            <div>
              <div className="panel">
                <div className="panel-title">Weekly Inventory Summary</div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Unit</th>
                        <th className="num">Opening</th>
                        <th className="num">Purchases</th>
                        <th className="num">Sales</th>
                        <th className="num">Variance</th>
                        <th className="num">Days Tracked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyInv.map((r) => (
                        <tr key={r.product_id}>
                          <td>{r.product_name}</td>
                          <td>{r.unit_name || '—'}</td>
                          <td className="num">{fmt(r.opening_qty)}</td>
                          <td className="num">{fmt(r.purchases_qty)}</td>
                          <td className="num">{fmt(r.sales_qty)}</td>
                          <td className="num" style={{ color: r.variance_qty !== 0 ? '#ef4444' : '#22c55e' }}>
                            {r.variance_qty !== 0 ? fmt(r.variance_qty) : '0'}
                          </td>
                          <td className="num">{r.days_tracked}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Monthly Inventory ── */}
          {invSubTab === 'monthly' && monthlyInv.length > 0 && (
            <div>
              <div className="panel">
                <div className="panel-title">Monthly Inventory Summary</div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Unit</th>
                        <th className="num">Purchased</th>
                        <th className="num">Sold</th>
                        <th className="num">Avg Cost</th>
                        <th className="num">Avg Selling</th>
                        <th className="num">Current Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyInv.map((r) => (
                        <tr key={r.product_id}>
                          <td>{r.product_name}</td>
                          <td>{r.category_name || '—'}</td>
                          <td>{r.unit_name || '—'}</td>
                          <td className="num">{fmt(r.total_purchased)}</td>
                          <td className="num">{fmt(r.total_sold)}</td>
                          <td className="num">{fmt(r.avg_cost)}</td>
                          <td className="num">{fmt(r.avg_selling_price)}</td>
                          <td className="num">{fmt(r.current_stock)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ExportButtons
                  reportType="monthly-inventory"
                  data={monthlyInv}
                  xlsx={{
                    name: 'monthly-inventory',
                    headers: ['Product', 'Category', 'Unit', 'Purchased', 'Sold', 'AvgCost', 'AvgPrice', 'Stock'],
                    rows: monthlyInv.map((r) => [
                      r.product_name, r.category_name || '', r.unit_name || '',
                      r.total_purchased, r.total_sold, r.avg_cost, r.avg_selling_price, r.current_stock
                    ]),
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Purchase History ── */}
          {invSubTab === 'purchaseHistory' && (
            <div>
              <div className="panel">
                <div className="panel-title">Purchase History</div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Product</th>
                        <th>Supplier</th>
                        <th>Qty Ordered</th>
                        <th>Qty Received</th>
                        <th>Unit</th>
                        <th className="num">Unit Cost</th>
                        <th className="num">Total</th>
                        <th>Status</th>
                        <th>Batch / Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseHistory.map((r) => (
                        <tr key={r.id}>
                          <td>{r.order_date}</td>
                          <td>{r.product_name}</td>
                          <td>{r.supplier_name}</td>
                          <td className="num">{fmt(r.quantity_ordered)}</td>
                          <td className="num">{r.quantity_received != null ? fmt(r.quantity_received) : '—'}</td>
                          <td>{r.unit_name || '—'}</td>
                          <td className="num">{fmt(r.cost_per_unit)}</td>
                          <td className="num">{fmt(r.total_cost)}</td>
                          <td>{r.delivery_status}</td>
                          <td>{r.batch_number || 'N/A'} / {r.expiry_date || 'N/A'}</td>
                        </tr>
                      ))}
                      {purchaseHistory.length === 0 && (
                        <tr>
                          <td colSpan={10} className="muted center">No purchase records in selected period.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {purchaseHistory.length > 0 && (
                  <ExportButtons
                    reportType="purchase-history"
                    data={purchaseHistory}
                    xlsx={{
                      name: 'purchase-history',
                      headers: ['Date', 'Product', 'Supplier', 'Ordered', 'Received', 'Unit', 'Cost', 'Total', 'Status', 'Batch/Expiry'],
                      rows: purchaseHistory.map((r) => [
                        r.order_date, r.product_name, r.supplier_name, r.quantity_ordered,
                        r.quantity_received ?? '', r.unit_name || '',
                        r.cost_per_unit, r.total_cost, r.delivery_status,
                        `${r.batch_number || ''}/${r.expiry_date || ''}`
                      ]),
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Supplier Metrics ── */}
          {invSubTab === 'supplierMetrics' && (
            <div>
              <div className="panel">
                <div className="panel-title">Supplier Metrics</div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th className="num">Orders</th>
                        <th className="num">Total Spent</th>
                        <th className="num">On-Time %</th>
                        <th className="num">Avg Cost</th>
                        <th>Reliability</th>
                        <th>Last Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierMetrics.map((s) => (
                        <tr key={s.supplier_id}>
                          <td>{s.supplier_name}</td>
                          <td className="num">{s.total_orders}</td>
                          <td className="num">{fmt(s.total_spent)}</td>
                          <td className="num">{fmt(s.on_time_pct)}%</td>
                          <td className="num">{fmt(s.average_cost)}</td>
                          <td>
                            <span className={`badge badge-${
                              s.reliability_score >= 4 ? 'ok' : s.reliability_score >= 2.5 ? 'warn' : 'danger'
                            }`}>
                              {fmt(s.reliability_score)} / 5
                            </span>
                          </td>
                          <td>{s.last_order_date || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

       {/* ============ ALERTS (v1.8.0) ============ */}
       {tab === 'alerts' && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const count = await window.api.alerts.checkNow();
                setNotice(`Check complete: ${count} new alert(s)`);
                setAlerts(await window.api.alerts.getAll());
              }}
            >
              Run Check Now
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const snap = await window.api.inventoryReports.createDailySnapshot(today());
                setNotice(`Snapshot: ${snap.created} products`);
              }}
            >
              Create Daily Snapshot
            </button>
          </div>

          {alerts.length === 0 ? (
            <div className="muted center" style={{ padding: 24 }}>
              No alerts. All systems healthy.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th style={{ width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} style={a.is_read ? { opacity: 0.6 } : undefined}>
                    <td className="num">{a.created_at?.substring(0, 10)}</td>
                    <td>{a.alert_type.replace('_', ' ')}</td>
                    <td>
                      <span
                        style={{
                          color:
                            a.severity === 'critical'
                              ? '#ef4444'
                              : a.severity === 'warning'
                              ? '#f59e0b'
                              : '#3b82f6',
                          fontWeight: a.severity === 'critical' ? 'bold' : 'normal',
                        }}
                      >
                        {a.severity}
                      </span>
                    </td>
                    <td>{a.message}</td>
                    <td>{a.is_read ? 'Resolved' : 'Active'}</td>
                    <td>
                      {!a.is_read && (
                        <>
                          <button
                            className="btn btn-sm"
                            onClick={async () => {
                              await window.api.alerts.markAsRead(a.id);
                              setAlerts(await window.api.alerts.getAll());
                            }}
                          >
                            Ack
                          </button>
                          {' '}
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={async () => {
                              await window.api.alerts.resolve(a.id, 'Manual resolution');
                              setAlerts(await window.api.alerts.getAll());
                            }}
                          >
                            Resolve
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
       )}

       {/* ============ PROFITABILITY (v1.8.0) ============ */}
       {tab === 'profitability' && (
        <div>
          <div className="tabs" style={{ marginBottom: 16 }}>
            {(
              [
                ['daily', 'Daily'],
                ['weekly', 'Weekly'],
                ['monthly', 'Monthly'],
                ['category', 'By Category'],
                ['breakEven', 'Break-Even'],
                ['lowProfit', 'Low Profit'],
                ['topProducts', 'Top Products'],
                ['worstProducts', 'Worst Products'],
              ] as [typeof profitSubTab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                className={profitSubTab === k ? 'tab-btn active' : 'tab-btn'}
                onClick={() => setProfitSubTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {(['daily', 'weekly', 'monthly', 'topProducts'].includes(profitSubTab)) && profitData.length >= 0 && (
            <div>
              {profitData.length === 0 ? (
                <div className="muted center" style={{ padding: 24 }}>No data for this period.</div>
              ) : (
                <>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Sold</th>
                        <th>Revenue</th>
                        <th>COGS</th>
                        <th>Profit</th>
                        <th>Margin %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profitData.map((p) => (
                        <tr key={p.product_id}>
                          <td>{p.product_name}</td>
                          <td>{p.category || '—'}</td>
                          <td className="num">{fmt(p.units_sold)}</td>
                          <td className="num">{fmt(p.revenue)}</td>
                          <td className="num">{fmt(p.cost_of_goods)}</td>
                          <td className="num">{fmt(p.gross_profit)}</td>
                          <td className="num">{fmt(p.profit_margin_pct)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 12 }}>
                    <ExportButtons
                      reportType="profitability-table"
                      data={profitData}
                      xlsx={{
                        name: `Profitability-${profitSubTab}`,
                        headers: ['Product', 'Category', 'Sold', 'Revenue', 'COGS', 'Profit', 'Margin%'],
                        rows: profitData.map((p) => [
                          p.product_name,
                          p.category || '',
                          p.units_sold,
                          p.revenue,
                          p.cost_of_goods,
                          p.gross_profit,
                          p.profit_margin_pct,
                        ]),
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {profitSubTab === 'category' && categoryProfit.length >= 0 && (
            <div>
              {categoryProfit.length === 0 ? (
                <div className="muted center" style={{ padding: 24 }}>No category data.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Products</th>
                      <th>Units Sold</th>
                      <th>Revenue</th>
                      <th>COGS</th>
                      <th>Profit</th>
                      <th>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryProfit.map((c) => (
                      <tr key={c.category_name || 'N/A'}>
                        <td>{c.category_name || 'Uncategorized'}</td>
                        <td className="num">{c.product_count}</td>
                        <td className="num">{fmt(c.units_sold)}</td>
                        <td className="num">{fmt(c.revenue)}</td>
                        <td className="num">{fmt(c.cost_of_goods)}</td>
                        <td className="num">{fmt(c.gross_profit)}</td>
                        <td className="num">{fmt(c.profit_margin_pct)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {profitSubTab === 'breakEven' && breakEven.length >= 0 && (
            <div>
              {breakEven.length === 0 ? (
                <div className="muted center" style={{ padding: 24 }}>No products with cost data.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Cost</th>
                      <th>Sale Price</th>
                      <th>Break-Even Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakEven.map((b) => (
                      <tr key={b.product_id}>
                        <td>{b.product_name}</td>
                        <td className="num">{fmt(b.cost_price)}</td>
                        <td className="num">{fmt(b.sale_price)}</td>
                        <td className="num">{fmt(b.break_even_price)}</td>
                        <td
                          style={{
                            color:
                              b.status === 'Profitable'
                                ? '#22c55e'
                                : b.status === 'Below Break-Even'
                                ? '#ef4444'
                                : '#6b7280',
                          }}
                        >
                          {b.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {profitSubTab === 'lowProfit' && lowProfitData.length >= 0 && (
            <div>
              {lowProfitData.length === 0 ? (
                <div className="muted center" style={{ padding: 24 }}>No low-margin products found.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Cost</th>
                      <th>Sale Price</th>
                      <th>Profit/Unit</th>
                      <th>Margin %</th>
                      <th>Sold 30d</th>
                      <th>Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowProfitData.map((lp) => (
                      <tr key={lp.product_id}>
                        <td>{lp.product_name}</td>
                        <td className="num">{fmt(lp.cost_price)}</td>
                        <td className="num">{fmt(lp.sale_price)}</td>
                        <td className="num">{fmt(lp.profit_per_unit)}</td>
                        <td className="num">{fmt(lp.margin_pct)}%</td>
                        <td className="num">{lp.sold_last_30days}</td>
                        <td className="num">{fmt(lp.stock_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {profitSubTab === 'worstProducts' && worstProducts.length >= 0 && (
            <div>
              {worstProducts.length === 0 ? (
                <div className="muted center" style={{ padding: 24 }}>No product data.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Units Sold</th>
                      <th>Revenue</th>
                      <th>COGS</th>
                      <th>Profit</th>
                      <th>Margin %</th>
                      <th>Stock</th>
                      <th>Days No Sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worstProducts.map((w) => (
                      <tr key={w.product_id}>
                        <td>{w.product_name}</td>
                        <td>{w.category || '—'}</td>
                        <td className="num">{w.units_sold}</td>
                        <td className="num">{fmt(w.revenue)}</td>
                        <td className="num">{fmt(w.cogs)}</td>
                        <td className="num">{fmt(w.total_profit)}</td>
                        <td className="num">{fmt(w.profit_margin_pct)}%</td>
                        <td className="num">{fmt(w.stock_qty)}</td>
                        <td className="num">{w.days_no_sale ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
       )}
    </div>
  );
}
