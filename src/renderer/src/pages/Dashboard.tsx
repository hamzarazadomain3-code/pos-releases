import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
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
import type { DailyStats, HourlyTrendRow, TopProductRow } from '../../../shared/types';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'];

const CardIcons = {
  sales: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  bills: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 10h8" />
      <path d="M8 14h4" />
    </svg>
  ),
  avg: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="12" y2="14" />
    </svg>
  ),
  orders: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  parties: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  products: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  outOfStock: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  saleReturn: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9 7 9-7" />
      <path d="M9 22V4" />
    </svg>
  ),
  paymentIn: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  paymentOut: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M5 5H3.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H4" />
    </svg>
  ),
  payable: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  receivable: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  expense: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  lowStock: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  negativeStock: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  expiring: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6" />
      <path d="M10 2v4" />
      <path d="M14 2v4" />
      <path d="M18 2v4" />
    </svg>
  ),
};

const KPI_GRADIENTS = {
  sales: 'linear-gradient(135deg, #10b981, #059669)',
  totalSale: 'linear-gradient(135deg, #059669, #047857)',
  bills: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
  avg: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  orders: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  parties: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
  products: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  outOfStock: 'linear-gradient(135deg, #ef4444, #dc2626)',
  saleReturn: 'linear-gradient(135deg, #ef4444, #dc2626)',
  paymentIn: 'linear-gradient(135deg, #10b981, #059669)',
  paymentOut: 'linear-gradient(135deg, #ef4444, #dc2626)',
  payable: 'linear-gradient(135deg, #f97316, #ea580c)',
  receivable: 'linear-gradient(135deg, #ec4899, #db2777)',
  expense: 'linear-gradient(135deg, #ef4444, #dc2626)',
  lowStock: 'linear-gradient(135deg, #f97316, #ea580c)',
  negativeStock: 'linear-gradient(135deg, #dc2626, #b91c1c)',
  expiring: 'linear-gradient(135deg, #f59e0b, #d97706)',
};

const KPI_SHADOWS = {
  sales: '0 4px 12px rgba(16, 185, 129, 0.25)',
  totalSale: '0 4px 12px rgba(5, 150, 105, 0.25)',
  bills: '0 4px 12px rgba(59, 130, 246, 0.25)',
  avg: '0 4px 12px rgba(139, 92, 246, 0.25)',
  orders: '0 4px 12px rgba(59, 130, 246, 0.25)',
  parties: '0 4px 12px rgba(37, 99, 235, 0.25)',
  products: '0 4px 12px rgba(139, 92, 246, 0.25)',
  outOfStock: '0 4px 12px rgba(239, 68, 68, 0.25)',
  saleReturn: '0 4px 12px rgba(239, 68, 68, 0.25)',
  paymentIn: '0 4px 12px rgba(16, 185, 129, 0.25)',
  paymentOut: '0 4px 12px rgba(239, 68, 68, 0.25)',
  payable: '0 4px 12px rgba(249, 115, 22, 0.25)',
  receivable: '0 4px 12px rgba(236, 72, 153, 0.25)',
  expense: '0 4px 12px rgba(239, 68, 68, 0.25)',
  lowStock: '0 4px 12px rgba(249, 115, 22, 0.25)',
  negativeStock: '0 4px 12px rgba(220, 38, 38, 0.25)',
  expiring: '0 4px 12px rgba(245, 158, 11, 0.25)',
};

export default function Dashboard() {
  const [salesData, setSalesData] = useState<HourlyTrendRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    total_sales: 0,
    bill_count: 0,
    avg_bill: 0,
  });
  const [lowStockCount, setLowStockCount] = useState(0);
  const [outOfStockCount, setOutOfStockCount] = useState(0);
  const [todayExpenses, setTodayExpenses] = useState(0);
  const [udhaarDue, setUdhaarDue] = useState(0);
  const [negativeStockCount, setNegativeStockCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [totalParties, setTotalParties] = useState(0);
  const [saleReturnAmount, setSaleReturnAmount] = useState(0);
  const [paymentInAmount, setPaymentInAmount] = useState(0);
  const [paymentOutAmount, setPaymentOutAmount] = useState(0);
  const [payableBalance, setPayableBalance] = useState(0);
  const [receivableBalance, setReceivableBalance] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [trend, top, stats, lowStock, inventory, parties, returns, payments, payables, receivables, expiring] = await Promise.all([
        window.api.reports.getDailySalesTrend(),
        window.api.reports.getTopProducts(5),
        window.api.reports.getDailyStats(),
        window.api.inventory.lowStock().catch(() => []),
        window.api.inventory.list().catch(() => []),
        window.api.customers.list().catch(() => []),
        window.api.sales.list(undefined, undefined, true).catch(() => []),
        window.api.sales.list(undefined, undefined, false, undefined, undefined, 'Cash').catch(() => []),
        window.api.sales.list(undefined, undefined, false, undefined, undefined, 'Card').catch(() => []),
        window.api.customers.ledger(0).catch(() => []),
        window.api.reports.expiringSoon(30).catch(() => []),
      ]);

      setSalesData(trend);
      setTopProducts(top);
      setDailyStats(stats);
      setLowStockCount(lowStock.length);
      setOutOfStockCount(inventory.filter((p: any) => p.stock_qty <= 0).length);
      setNegativeStockCount(inventory.filter((p: any) => p.stock_qty < 0).length);
      setTotalProducts(inventory.filter((p: any) => p.active !== 0).length);
      setTotalParties(parties.filter((p: any) => p.active !== 0).length);
      setExpiringCount(expiring.length);

      const returnTotal = returns.reduce((sum: number, r: any) => sum + (r.total_amount || 0), 0);
      setSaleReturnAmount(returnTotal);

      const paymentInTotal = payments.reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
      setPaymentInAmount(paymentInTotal);

      const paymentOutTotal = 0; // Would need expense data
      setPaymentOutAmount(paymentOutTotal);

      const payableTotal = parties.reduce((sum: number, c: any) => sum + (c.balance || 0), 0);
      setPayableBalance(payableTotal > 0 ? payableTotal : 0);

      const receivableTotal = parties.reduce((sum: number, c: any) => sum + (c.balance || 0), 0);
      setReceivableBalance(receivableTotal > 0 ? receivableTotal : 0);

      const dashData = await (window.api as any).reports.dashboard?.().catch(() => null);
      if (dashData) {
        setTodayExpenses(dashData.today_expenses || 0);
        setUdhaarDue(dashData.udhaar_due || 0);
      }

      setLoaded(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const KpiCard = ({ label, value, icon, gradient, shadow, isNegative }: {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    gradient: string;
    shadow: string;
    isNegative?: boolean;
  }) => (
    <div
      className="billten-kpi-card"
      style={{
        background: gradient,
        boxShadow: shadow,
      }}
    >
      <div className="billten-kpi-icon">{icon}</div>
      <div className="billten-kpi-label">{label}</div>
      <div className="billten-kpi-value" style={{ color: isNegative ? '#fff' : '#fff' }}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="toolbar">
          <button className="btn btn-sm" onClick={loadData}>
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {/* Row 1: Sales & Revenue Metrics (Green) */}
      <div className="billten-kpi-grid-row1">
        <KpiCard
          label="Today's Sales"
          value={`Rs ${fmt(dailyStats.total_sales)}`}
          icon={CardIcons.sales}
          gradient={KPI_GRADIENTS.sales}
          shadow={KPI_SHADOWS.sales}
        />
        <KpiCard
          label="Total Sale"
          value={`Rs ${fmt(dailyStats.total_sales)}`}
          icon={CardIcons.sales}
          gradient={KPI_GRADIENTS.totalSale}
          shadow={KPI_SHADOWS.totalSale}
        />
        <KpiCard
          label="Total Orders"
          value={dailyStats.bill_count}
          icon={CardIcons.bills}
          gradient={KPI_GRADIENTS.bills}
          shadow={KPI_SHADOWS.bills}
        />
        <KpiCard
          label="Avg Bill Value"
          value={`Rs ${fmt(dailyStats.avg_bill)}`}
          icon={CardIcons.avg}
          gradient={KPI_GRADIENTS.avg}
          shadow={KPI_SHADOWS.avg}
        />
      </div>

      {/* Row 2: Customer & Product Metrics (Blue/Purple) */}
      <div className="billten-kpi-grid-row2">
        <KpiCard
          label="Total Parties"
          value={totalParties}
          icon={CardIcons.parties}
          gradient={KPI_GRADIENTS.parties}
          shadow={KPI_SHADOWS.parties}
        />
        <KpiCard
          label="Total Products"
          value={totalProducts}
          icon={CardIcons.products}
          gradient={KPI_GRADIENTS.products}
          shadow={KPI_SHADOWS.products}
        />
        <KpiCard
          label="Out of Stock"
          value={outOfStockCount}
          icon={CardIcons.outOfStock}
          gradient={KPI_GRADIENTS.outOfStock}
          shadow={KPI_SHADOWS.outOfStock}
        />
        <KpiCard
          label="Sale Return"
          value={`Rs ${fmt(saleReturnAmount)}`}
          icon={CardIcons.saleReturn}
          gradient={KPI_GRADIENTS.saleReturn}
          shadow={KPI_SHADOWS.saleReturn}
        />
      </div>

      {/* Row 3: Payment & Balance Metrics */}
      <div className="billten-kpi-grid-row3">
        <KpiCard
          label="Payment In"
          value={`Rs ${fmt(paymentInAmount)}`}
          icon={CardIcons.paymentIn}
          gradient={KPI_GRADIENTS.paymentIn}
          shadow={KPI_SHADOWS.paymentIn}
        />
        <KpiCard
          label="Payment Out"
          value={`Rs ${fmt(paymentOutAmount)}`}
          icon={CardIcons.paymentOut}
          gradient={KPI_GRADIENTS.paymentOut}
          shadow={KPI_SHADOWS.paymentOut}
        />
        <KpiCard
          label="Total Payable"
          value={`Rs ${fmt(payableBalance)}`}
          icon={CardIcons.payable}
          gradient={KPI_GRADIENTS.payable}
          shadow={KPI_SHADOWS.payable}
        />
        <KpiCard
          label="Total Receivable"
          value={`Rs ${fmt(receivableBalance)}`}
          icon={CardIcons.receivable}
          gradient={KPI_GRADIENTS.receivable}
          shadow={KPI_SHADOWS.receivable}
        />
      </div>

      {/* Row 4: Expense & Stock Alerts */}
      <div className="billten-kpi-grid-row4">
        <KpiCard
          label="Total Expense"
          value={`Rs ${fmt(todayExpenses)}`}
          icon={CardIcons.expense}
          gradient={KPI_GRADIENTS.expense}
          shadow={KPI_SHADOWS.expense}
        />
        <KpiCard
          label="Low Stock Items"
          value={lowStockCount}
          icon={CardIcons.lowStock}
          gradient={KPI_GRADIENTS.lowStock}
          shadow={KPI_SHADOWS.lowStock}
        />
        <KpiCard
          label="Negative Stock"
          value={negativeStockCount}
          icon={CardIcons.negativeStock}
          gradient={KPI_GRADIENTS.negativeStock}
          shadow={KPI_SHADOWS.negativeStock}
        />
        <KpiCard
          label="Expiring Products"
          value={expiringCount}
          icon={CardIcons.expiring}
          gradient={KPI_GRADIENTS.expiring}
          shadow={KPI_SHADOWS.expiring}
        />
      </div>

      <div className="panel">
        <div className="panel-title">Hourly Sales Trend (Today)</div>
        {salesData.length > 0 && salesData.some((r) => r.amount > 0) ? (
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" interval={2} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="amount" stroke="#8884d8" strokeWidth={2} name="Sales (Rs)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="muted">{loaded ? 'No sales recorded today yet.' : 'Loading…'}</p>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Top 5 Products (Today)</div>
        {topProducts.length > 0 ? (
          <>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="qty_sold" name="Qty Sold" fill="#82ca9d" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={topProducts}
                    dataKey="qty_sold"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(e: any) => (e.name ? String(e.name).slice(0, 12) : '')}
                  >
                    {topProducts.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <p className="muted">{loaded ? 'No sales recorded today yet.' : 'Loading…'}</p>
        )}
      </div>
    </div>
  );
}