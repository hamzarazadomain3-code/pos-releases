import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PartyTransferRow, BankAccountRow, BankTransferRow, Customer, Supplier } from '../../../shared/types';

type Tab = 'party' | 'bank';

export default function Transfers() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('party');

  // Party transfers state
  const [partyTransfers, setPartyTransfers] = useState<PartyTransferRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [partyLoading, setPartyLoading] = useState(true);

  // Party transfer form
  const [partyFormOpen, setPartyFormOpen] = useState(false);
  const [fromPartyType, setFromPartyType] = useState<'customer' | 'supplier'>('customer');
  const [fromPartyId, setFromPartyId] = useState<number | ''>('');
  const [toPartyType, setToPartyType] = useState<'customer' | 'supplier'>('customer');
  const [toPartyId, setToPartyId] = useState<number | ''>('');
  const [partyAmount, setPartyAmount] = useState('');
  const [partyRef, setPartyRef] = useState('');
  const [partyNotes, setPartyNotes] = useState('');
  const [partySaving, setPartySaving] = useState(false);

  // Bank transfers state
  const [bankTransfers, setBankTransfers] = useState<BankTransferRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [bankLoading, setBankLoading] = useState(true);

  // Bank transfer form
  const [bankFormOpen, setBankFormOpen] = useState(false);
  const [fromAccountId, setFromAccountId] = useState<number | ''>('');
  const [toAccountId, setToAccountId] = useState<number | ''>('');
  const [bankAmount, setBankAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [bankNotes, setBankNotes] = useState('');
  const [bankSaving, setBankSaving] = useState(false);

  // Bank account form
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [iban, setIban] = useState('');
  const [branch, setBranch] = useState('');
  const [currency, setCurrency] = useState('PKR');
  const [accountSaving, setAccountSaving] = useState(false);

  // Shared
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  // Load party data
  useEffect(() => {
    Promise.all([
      window.api.transfers.party.list(),
      window.api.customers.list(),
      window.api.purchases.suppliers(),
    ]).then(([transfers, custs, sups]) => {
      setPartyTransfers(transfers);
      setCustomers(custs);
      setSuppliers(sups);
      setPartyLoading(false);
    }).catch(() => setPartyLoading(false));
  }, []);

  // Load bank data
  useEffect(() => {
    Promise.all([
      window.api.transfers.bank.list(),
      window.api.transfers.bank.listAccounts(),
    ]).then(([transfers, accounts]) => {
      setBankTransfers(transfers);
      setBankAccounts(accounts);
      setBankLoading(false);
    }).catch(() => setBankLoading(false));
  }, []);

  // Party transfer handlers
  const handlePartyCreate = async () => {
    setPartySaving(true);
    setErr(''); setSuccess('');
    try {
      const user = await window.api.auth.currentUser();
      const res = await window.api.transfers.party.create({
        from_party_id: Number(fromPartyId),
        from_party_type: fromPartyType,
        to_party_id: Number(toPartyId),
        to_party_type: toPartyType,
        amount: Number(partyAmount),
        reference: partyRef || null,
        notes: partyNotes || null,
        created_by: user?.id || 1,
      });
      if (res.ok) {
        setSuccess('Party transfer created');
        setPartyFormOpen(false);
        setPartyAmount(''); setPartyRef(''); setPartyNotes('');
        loadParty();
      } else setErr(res.message || 'Failed');
    } catch (e) { setErr(String(e)); } finally { setPartySaving(false); }
  };

  const loadParty = () => {
    setPartyLoading(true);
    window.api.transfers.party.list().then(setPartyTransfers).finally(() => setPartyLoading(false));
  };

  // Bank account handlers
  const handleAccountCreate = async () => {
    setAccountSaving(true);
    setErr(''); setSuccess('');
    try {
      const res = await window.api.transfers.bank.createAccount({
        name: accountName,
        bank_name: bankName || null,
        account_number: accountNumber || null,
        iban: iban || null,
        branch: branch || null,
        currency,
      });
      if (res.ok) {
        setSuccess('Bank account created');
        setAccountFormOpen(false);
        setAccountName(''); setBankName(''); setAccountNumber(''); setIban(''); setBranch('');
        loadBank();
      } else setErr(res.message || 'Failed');
    } catch (e) { setErr(String(e)); } finally { setAccountSaving(false); }
  };

  // Bank transfer handlers
  const handleBankCreate = async () => {
    setBankSaving(true);
    setErr(''); setSuccess('');
    try {
      const user = await window.api.auth.currentUser();
      const res = await window.api.transfers.bank.create({
        from_account_id: Number(fromAccountId),
        to_account_id: Number(toAccountId),
        amount: Number(bankAmount),
        reference: bankRef || null,
        notes: bankNotes || null,
        created_by: user?.id || 1,
      });
      if (res.ok) {
        setSuccess('Bank transfer created');
        setBankFormOpen(false);
        setBankAmount(''); setBankRef(''); setBankNotes('');
        loadBank();
      } else setErr(res.message || 'Failed');
    } catch (e) { setErr(String(e)); } finally { setBankSaving(false); }
  };

  const loadBank = () => {
    setBankLoading(true);
    window.api.transfers.bank.list().then(setBankTransfers);
    window.api.transfers.bank.listAccounts().then(setBankAccounts).finally(() => setBankLoading(false));
  };

  const fmt = (n: number) => n?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '0';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Transfers</h1>
        <div className="row-btns">
          <button className={`btn ${tab === 'party' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('party')}>
            Party to Party
          </button>
          <button className={`btn ${tab === 'bank' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('bank')}>
            Bank to Bank
          </button>
        </div>
      </div>

      {err && <div className="card"><p className="text-warn">{err}</p></div>}
      {success && <div className="card"><p style={{ color: '#16a34a' }}>{success}</p></div>}

      {tab === 'party' && (
        <>
          <div className="row-btns" style={{ marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={() => setPartyFormOpen(true)}>New Party Transfer</button>
          </div>

          <div className="card">
            {partyLoading ? <p className="muted center pad">Loading…</p> : partyTransfers.length === 0 ? <p className="muted center pad">No party transfers</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>To</th>
                      <th>Amount</th>
                      <th>Reference</th>
                      <th>By</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partyTransfers.map((t) => (
                      <tr key={t.id}>
                        <td>{t.from_party_type === 'customer' ? '👤' : '🏢'} {t.from_party_name || `ID: ${t.from_party_id}`}</td>
                        <td>{t.to_party_type === 'customer' ? '👤' : '🏢'} {t.to_party_name || `ID: ${t.to_party_id}`}</td>
                        <td>{fmt(t.amount)}</td>
                        <td>{t.reference || '—'}</td>
                        <td>{t.created_by_name || '—'}</td>
                        <td>{new Date(t.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {partyFormOpen && (
            <div className="modal-overlay" onClick={() => setPartyFormOpen(false)}>
              <div className="modal" style={{ maxWidth: 520, width: '95%' }} onClick={(e) => e.stopPropagation()}>
                <div className="row-btns" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2>New Party Transfer</h2>
                  <button className="btn btn-sm" onClick={() => setPartyFormOpen(false)}>✕</button>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>From Type</label>
                    <select value={fromPartyType} onChange={(e) => { setFromPartyType(e.target.value as 'customer' | 'supplier'); setFromPartyId(''); }}>
                      <option value="customer">Customer</option>
                      <option value="supplier">Supplier</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>From Party</label>
                    <select value={fromPartyId} onChange={(e) => setFromPartyId(e.target.value ? Number(e.target.value) : '')}>
                      {fromPartyType === 'customer' ? (
                        customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                      ) : (
                        suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                      )}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>To Type</label>
                    <select value={toPartyType} onChange={(e) => { setToPartyType(e.target.value as 'customer' | 'supplier'); setToPartyId(''); }}>
                      <option value="customer">Customer</option>
                      <option value="supplier">Supplier</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>To Party</label>
                    <select value={toPartyId} onChange={(e) => setToPartyId(e.target.value ? Number(e.target.value) : '')}>
                      {toPartyType === 'customer' ? (
                        customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                      ) : (
                        suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                      )}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Amount</label>
                  <input type="number" min="0.01" step="0.01" value={partyAmount} onChange={(e) => setPartyAmount(e.target.value)} required />
                </div>

                <div className="form-group">
                  <label>Reference</label>
                  <input value={partyRef} onChange={(e) => setPartyRef(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={partyNotes} onChange={(e) => setPartyNotes(e.target.value)} rows={2} />
                </div>

                <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn" onClick={() => setPartyFormOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={!fromPartyId || !toPartyId || !partyAmount || partySaving} onClick={handlePartyCreate}>
                    {partySaving ? 'Saving…' : 'Create Transfer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'bank' && (
        <>
          <div className="row-btns" style={{ marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={() => setBankFormOpen(true)}>New Bank Transfer</button>
            <button className="btn" onClick={() => setAccountFormOpen(true)}>New Bank Account</button>
          </div>

          <div className="card">
            {bankLoading ? <p className="muted center pad">Loading…</p> : bankTransfers.length === 0 ? <p className="muted center pad">No bank transfers</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>From Account</th>
                      <th>To Account</th>
                      <th>Amount</th>
                      <th>Reference</th>
                      <th>By</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankTransfers.map((t) => (
                      <tr key={t.id}>
                        <td>{t.from_account_name}</td>
                        <td>{t.to_account_name}</td>
                        <td>{fmt(t.amount)}</td>
                        <td>{t.reference || '—'}</td>
                        <td>{t.created_by_name || '—'}</td>
                        <td>{new Date(t.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Bank Transfer Form */}
          {bankFormOpen && (
            <div className="modal-overlay" onClick={() => setBankFormOpen(false)}>
              <div className="modal" style={{ maxWidth: 520, width: '95%' }} onClick={(e) => e.stopPropagation()}>
                <div className="row-btns" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2>New Bank Transfer</h2>
                  <button className="btn btn-sm" onClick={() => setBankFormOpen(false)}>✕</button>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>From Account</label>
                    <select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value ? Number(e.target.value) : '')}>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({fmt(a.current_balance)})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>To Account</label>
                    <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value ? Number(e.target.value) : '')}>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({fmt(a.current_balance)})</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Amount</label>
                  <input type="number" min="0.01" step="0.01" value={bankAmount} onChange={(e) => setBankAmount(e.target.value)} required />
                </div>

                <div className="form-group">
                  <label>Reference</label>
                  <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={bankNotes} onChange={(e) => setBankNotes(e.target.value)} rows={2} />
                </div>

                <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn" onClick={() => setBankFormOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={!fromAccountId || !toAccountId || !bankAmount || bankSaving} onClick={handleBankCreate}>
                    {bankSaving ? 'Saving…' : 'Create Transfer'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bank Account Form */}
          {accountFormOpen && (
            <div className="modal-overlay" onClick={() => setAccountFormOpen(false)}>
              <div className="modal" style={{ maxWidth: 520, width: '95%' }} onClick={(e) => e.stopPropagation()}>
                <div className="row-btns" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2>New Bank Account</h2>
                  <button className="btn btn-sm" onClick={() => setAccountFormOpen(false)}>✕</button>
                </div>

                <div className="form-group">
                  <label>Account Name</label>
                  <input value={accountName} onChange={(e) => setAccountName(e.target.value)} required />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Bank Name</label>
                    <input value={bankName} onChange={(e) => setBankName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Account Number</label>
                    <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>IBAN</label>
                    <input value={iban} onChange={(e) => setIban(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Branch</label>
                    <input value={branch} onChange={(e) => setBranch(e.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label>Currency</label>
                  <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
                </div>

                <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn" onClick={() => setAccountFormOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={!accountName || accountSaving} onClick={handleAccountCreate}>
                    {accountSaving ? 'Saving…' : 'Create Account'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bank Accounts List */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Bank Accounts</h3>
            {bankAccounts.length === 0 ? <p className="muted pad">No accounts</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Bank</th>
                      <th>Account #</th>
                      <th>Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.name}</strong></td>
                        <td>{a.bank_name || '—'}</td>
                        <td>{a.account_number || '—'}</td>
                        <td>{fmt(a.current_balance)} {a.currency}</td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                            background: a.is_active ? '#dcfce7' : '#fee2e2',
                            color: a.is_active ? '#166534' : '#991b1b',
                          }}>
                            {a.is_active ? 'Active' : 'Inactive'}
                          </span>
                          {a.is_default && <span className="ml-2">✓</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}