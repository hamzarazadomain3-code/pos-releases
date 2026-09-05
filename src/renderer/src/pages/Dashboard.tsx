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
  lowStock: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  outOfStock: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  expenses: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  udhaar: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

const KPI_GRADIENTS = {
  sales: 'linear-gradient(135deg, #10b981, #059669)',
  bills: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
  avg: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  lowStock: 'linear-gradient(135deg, #f97316, #ea580c)',
  outOfStock: 'linear-gradient(135deg, #ef4444, #dc2626)',
  expenses: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  udhaar: 'linear-gradient(135deg, #06b6d4, #0891b2)',
};

const KPI_SHADOWS = {
  sales: '0 4px 12px rgba(16, 185, 129, 0.25)',
  bills: '0 4px 12px rgba(59, 130, 246, 0.25)',
  avg: '0 4px 12px rgba(139, 92, 246, 0.25)',
  lowStock: '0 4px 12px rgba(249, 115, 22, 0.25)',
  outOfStock: '0 4px 12px rgba(239, 68, 68, 0.25)',
  expenses: '0 4px 12px rgba(139, 92, 246, 0.25)',
  udhaar: '0 4px 12px rgba(6, 182, 212, 0.25)',
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
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [trend, top, stats, lowStock, inventory] = await Promise.all([
        window.api.reports.getDailySalesTrend(),
        window.api.reports.getTopProducts(5),
        window.api.reports.getDailyStats(),
        window.api.inventory.lowStock().catch(() => []),
        window.api.inventory.list().catch(() => []),
      ]);
      setSalesData(trend);
      setTopProducts(top);
      setDailyStats(stats);
      setLowStockCount(lowStock.length);
      setOutOfStockCount(inventory.filter((p: any) => p.stock_qty <= 0).length);

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

  const KpiCard = ({ label, value, icon, gradient, shadow }: {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    gradient: string;
    shadow: string;
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
      <div className="billten-kpi-value">{value}</div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Sales Dashboard</h1>
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

      <div className="billten-kpi-grid-row1">
        <KpiCard
          label="Today's Sales"
          value={`Rs ${fmt(dailyStats.total_sales)}`}
          icon={CardIcons.sales}
          gradient={KPI_GRADIENTS.sales}
          shadow={KPI_SHADOWS.sales}
        />
        <KpiCard
          label="Total Bills"
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

      <div className="billten-kpi-grid-row2">
        <KpiCard
          label="Low Stock Items"
          value={lowStockCount}
          icon={CardIcons.lowStock}
          gradient={KPI_GRADIENTS.lowStock}
          shadow={KPI_SHADOWS.lowStock}
        />
        <KpiCard
          label="Out of Stock"
          value={outOfStockCount}
          icon={CardIcons.outOfStock}
          gradient={KPI_GRADIENTS.outOfStock}
          shadow={KPI_SHADOWS.outOfStock}
        />
        <KpiCard
          label="Today's Expenses"
          value={`Rs ${fmt(todayExpenses)}`}
          icon={CardIcons.expenses}
          gradient={KPI_GRADIENTS.expenses}
          shadow={KPI_SHADOWS.expenses}
        />
        <KpiCard
          label="Udhaar Due"
          value={`Rs ${fmt(udhaarDue)}`}
          icon={CardIcons.udhaar}
          gradient={KPI_GRADIENTS.udhaar}
          shadow={KPI_SHADOWS.udhaar}
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