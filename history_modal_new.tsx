{history && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Sales History</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select className="field-select" value={historyFilter} onChange={(e) => { setHistoryFilter(e.target.value as any); applyHistoryFilters(); }} style={{ width: '160px' }}>
                  <option value="completed">Completed</option>
                  <option value="voided">Voided</option>
                  <option value="held">Held</option>
                </select>
              </div>
            </div>
            
            {/* Filter Bar */}
            <div className="filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', padding: '12px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
              {/* Row 1: Date Preset, Date Range, Sale No, Status, Sort */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
                <select className="field-select" value={datePreset} onChange={(e) => applyDatePreset(e.target.value as any)} style={{ width: '140px' }}>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="lastmonth">Last Month</option>
                  <option value="custom">Custom</option>
                </select>
                <input type="date" value={historyFilters.from} onChange={(e) => setHistoryFilters(f => ({ ...f, from: e.target.value }))} title="From Date" style={{ width: '140px' }} />
                <span className="muted">to</span>
                <input type="date" value={historyFilters.to} onChange={(e) => setHistoryFilters(f => ({ ...f, to: e.target.value }))} title="To Date" style={{ width: '140px' }} />
                <input type="text" value={historyFilters.saleNo} onChange={(e) => setHistoryFilters(f => ({ ...f, saleNo: e.target.value }))} placeholder="Sale No (INV-...)" style={{ width: '180px' }} />
                <select className="field-select" value={historyFilters.status} onChange={(e) => { setHistoryFilters(f => ({ ...f, status: e.target.value })); applyHistoryFilters(); }} style={{ width: '140px' }}>
                  <option value="completed">Completed</option>
                  <option value="voided">Voided</option>
                  <option value="held">Held</option>
                </select>
                <select className="field-select" value={historyFilters.sortBy} onChange={(e) => { setHistoryFilters(f => ({ ...f, sortBy: e.target.value })); applyHistoryFilters(); }} style={{ width: '140px' }}>
                  <option value="date">Sort: Date</option>
                  <option value="amount">Sort: Amount</option>
                  <option value="saleNo">Sort: Sale No</option>
                </select>
                <select className="field-select" value={historyFilters.sortOrder} onChange={(e) => { setHistoryFilters(f => ({ ...f, sortOrder: e.target.value })); applyHistoryFilters(); }} style={{ width: '100px' }}>
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
              
              {/* Row 2: Customer, Cashier, Payment, Product, Amount Range, Only My Sales */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
                <input type="text" value={historyFilters.customerId} onChange={(e) => setHistoryFilters(f => ({ ...f, customerId: e.target.value }))} placeholder="Customer name..." style={{ width: '180px' }} />
                <select className="field-select" value={historyFilters.userId} onChange={(e) => setHistoryFilters(f => ({ ...f, userId: e.target.value }))} style={{ width: '160px' }}>
                  <option value="">All Cashiers</option>
                  {cashiers.map(u => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
                </select>
                <select className="field-select" value={historyFilters.paymentMode} onChange={(e) => setHistoryFilters(f => ({ ...f, paymentMode: e.target.value }))} style={{ width: '140px' }}>
                  <option value="">All Payments</option>
                  {paymentModes.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <input type="text" value={historyFilters.productId} onChange={(e) => setHistoryFilters(f => ({ ...f, productId: e.target.value }))} placeholder="Product name..." style={{ width: '180px' }} />
                <input type="number" value={historyFilters.minAmount} onChange={(e) => setHistoryFilters(f => ({ ...f, minAmount: e.target.value }))} placeholder="Min Amt" step="0.01" style={{ width: '100px' }} />
                <input type="number" value={historyFilters.maxAmount} onChange={(e) => setHistoryFilters(f => ({ ...f, maxAmount: e.target.value }))} placeholder="Max Amt" step="0.01" style={{ width: '100px' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#333' }}>
                  <input type="checkbox" checked={historyFilters.onlyMySales} onChange={(e) => setHistoryFilters(f => ({ ...f, onlyMySales: e.target.checked }))} />
                  Only My Sales
                </label>
              </div>
              
              {/* Row 3: Actions */}
              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <button className="btn btn-sm" onClick={clearHistoryFilters}>Clear Filters</button>
                <button className="btn btn-primary btn-sm" onClick={applyHistoryFilters}>Apply</button>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Sale No</th>
                    <th>Customer</th>
                    <th>Cashier</th>
                    <th>Payment</th>
                    <th>Subtotal</th>
                    <th>Discount</th>
                    <th>Tax</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.id} onClick={() => openSaleDetail(s.id)} style={{ cursor: 'pointer' }}>
                      <td>{s.invoice_no}</td>
                      <td>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                      <td>{s.created_at ? new Date(s.created_at).toLocaleTimeString() : '—'}</td>
                      <td>{s.invoice_no}</td>
                      <td>{s.customer_name ?? 'Walk-in'}</td>
                      <td>{s.cashier_name ?? '—'}</td>
                      <td>{Object.keys((s as any).paymentBreakdown || {}).join(', ') || '—'}</td>
                      <td>{(s as any).subtotal?.toFixed(2) ?? '—'}</td>
                      <td>{(s as any).discount_amount?.toFixed(2) ?? '—'}</td>
                      <td>{(s as any).tax_amount?.toFixed(2) ?? '—'}</td>
                      <td>{s.total_amount.toFixed(2)}</td>
                      <td>
                        <span className={`badge ${s.status === 'voided' ? 'badge-danger' : s.status === 'held' ? 'badge-warn' : ''}`}>{s.status}</span>
                      </td>
                      <td>
                        {s.status === 'completed' && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setVoidTarget(s);
                              setVoidReason('');
                            }}
                          >
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setHistory(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}