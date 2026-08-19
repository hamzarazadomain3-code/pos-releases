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
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [trend, top, stats] = await Promise.all([
        window.api.reports.getDailySalesTrend(),
        window.api.reports.getTopProducts(5),
        window.api.reports.getDailyStats(),
      ]);
      setSalesData(trend);
      setTopProducts(top);
      setDailyStats(stats);
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