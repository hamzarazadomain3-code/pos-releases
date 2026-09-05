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

      // Get expenses from dashboard API
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
        <div className="stat-card">
          <div className="stat-label">Today's Sales</div>
          <div className="stat-value" style={{ color: '#2ecc71' }}>Rs {fmt(dailyStats.total_sales)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Bills</div>
          <div className="stat-value" style={{ color: '#3498db' }}>{dailyStats.bill_count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Bill Value</div>
          <div className="stat-value" style={{ color: '#e74c3c' }}>Rs {fmt(dailyStats.avg_bill)}</div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat-card" style={{ borderLeft: '4px solid #f39c12' }}>
          <div className="stat-label">Low Stock Items</div>
          <div className="stat-value" style={{ color: lowStockCount > 0 ? '#f39c12' : '#2ecc71' }}>{lowStockCount}</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #e74c3c' }}>
          <div className="stat-label">Out of Stock</div>
          <div className="stat-value" style={{ color: outOfStockCount > 0 ? '#e74c3c' : '#2ecc71' }}>{outOfStockCount}</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #9b59b6' }}>
          <div className="stat-label">Today's Expenses</div>
          <div className="stat-value" style={{ color: '#9b59b6' }}>Rs {fmt(todayExpenses)}</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #e67e22' }}>
          <div className="stat-label">Udhaar Due</div>
          <div className="stat-value" style={{ color: udhaarDue > 0 ? '#e67e22' : '#2ecc71' }}>Rs {fmt(udhaarDue)}</div>
        </div>
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