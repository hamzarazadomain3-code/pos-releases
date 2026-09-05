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
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  bills: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 10h8" />
      <path d="M8 14h4" />
    </svg>
  ),
  avg: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="12" y2="14" />
    </svg>
  ),
  lowStock: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  outOfStock: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  expenses: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  udhaar: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
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

      <div className="stat-grid">
        <div
          style={{
            background: 'linear-gradient(135deg, #10b981, #059669)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 4px 20px rgba(16,185,129,0.25)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.3, color: '#fff' }}>
            {CardIcons.sales}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Today's Sales
          </div>
          <div style={{ color: '#fff', fontSize: 32, fontWeight: 700 }}>
            Rs {fmt(dailyStats.total_sales)}
          </div>
        </div>

        <div
          style={{
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 4px 20px rgba(59,130,246,0.25)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.3, color: '#fff' }}>
            {CardIcons.bills}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Total Bills
          </div>
          <div style={{ color: '#fff', fontSize: 32, fontWeight: 700 }}>
            {dailyStats.bill_count}
          </div>
        </div>

        <div
          style={{
            background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 4px 20px rgba(139,92,246,0.25)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.3, color: '#fff' }}>
            {CardIcons.avg}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Avg Bill Value
          </div>
          <div style={{ color: '#fff', fontSize: 32, fontWeight: 700 }}>
            Rs {fmt(dailyStats.avg_bill)}
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        {[
          {
            label: 'Low Stock Items',
            value: lowStockCount,
            accent: '#f59e0b',
            icon: CardIcons.lowStock,
            display: lowStockCount,
          },
          {
            label: 'Out of Stock',
            value: outOfStockCount,
            accent: '#ef4444',
            icon: CardIcons.outOfStock,
            display: outOfStockCount,
          },
          {
            label: "Today's Expenses",
            value: todayExpenses,
            accent: '#8b5cf6',
            icon: CardIcons.expenses,
            display: `Rs ${fmt(todayExpenses)}`,
          },
          {
            label: 'Udhaar Due',
            value: udhaarDue,
            accent: '#f59e0b',
            icon: CardIcons.udhaar,
            display: `Rs ${fmt(udhaarDue)}`,
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: '#fff',
              borderLeft: `4px solid ${card.accent}`,
              borderRadius: 14,
              padding: 20,
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              cursor: 'default',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.12)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)';
            }}
          >
            <div style={{ color: card.accent, flexShrink: 0, marginTop: 2 }}>
              {card.icon}
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                {card.label}
              </div>
              <div style={{ color: card.accent, fontSize: 26, fontWeight: 700 }}>
                {card.display}
              </div>
            </div>
          </div>
        ))}
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
