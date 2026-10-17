import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UdhaarEntryLineInput, UdhaarItemLookup } from '../../../shared/types';
import { Modal } from './Modal';
import { KeyboardInput } from './KeyboardInput';
import { formatMoney } from '../utils/currency';

/**
 * Add / Return Udhaar items.
 *
 * The scanner is the keyboard: the barcode box is focused on open and Enter
 * looks the code up — inventory first (real stock + retail/wholesale price),
 * then the Udhaar item catalog, and only if both miss does it ask for a name
 * (with the option to remember the barcode and/or add the product to Inventory).
 * Nothing is written until Save, which posts one atomic `createEntry`.
 */

type Direction = 'debit' | 'credit';

interface Line {
  key: string;
  product_id: number | null;
  barcode: string | null;
  name: string;
  unit: string | null;
  qty: string;
  rate: string;
  discount: string;
  batch: string | null;
  expiry: string | null;
  /** Inventory stock on hand (null for a catalog-only / typed line). */
  stock: number | null;
  remember?: boolean;
  add_to_inventory?: boolean;
}

interface NotFoundDraft {
  barcode: string | null;
  name: string;
  price: string;
  unit: string;
  batch: string;
  expiry: string;
  remember: boolean;
  addToInventory: boolean;
}

export interface UdhaarEntryModalProps {
  customerId: number;
  customerName: string;
  customerBalance: number;
  /** 'credit' opens the dialog preset to "Return items". */
  initialDirection?: Direction;
  onClose: () => void;
  /** Called with the new transaction id after a successful save. */
  onSaved?: (transactionId: number) => void;
}

let lineSeq = 0;
function nextKey(): string {
  lineSeq += 1;
  return `l${Date.now().toString(36)}-${lineSeq}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lineTotal(l: Line): number {
  return Math.max(0, Math.round((num(l.qty) * num(l.rate) - num(l.discount)) * 100) / 100);
}

export function UdhaarEntryModal({
  customerId,
  customerName,
  customerBalance,
  initialDirection = 'debit',
  onClose,
  onSaved,
}: UdhaarEntryModalProps) {
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [deductStock, setDeductStock] = useState(true);
  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');

  const [lines, setLines] = useState<Line[]>([]);
  const [code, setCode] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [suggestions, setSuggestions] = useState<UdhaarItemLookup[]>([]);
  const [notFound, setNotFound] = useState<NotFoundDraft | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ message: string; limit?: number; balance?: number } | null>(null);
  const [managerUsers, setManagerUsers] = useState<{ id: number; username: string; role: string }[]>([]);
  const [pinUserId, setPinUserId] = useState<number | null>(null);
  const [pinSecret, setPinSecret] = useState('');

  const [savedTxId, setSavedTxId] = useState<number | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  // Name autocomplete across inventory + catalog.
  useEffect(() => {
    const q = nameQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      window.api.udhaar
        .searchItems(q)
        .then((res) => {
          if (alive) setSuggestions(res.slice(0, 8));
        })
        .catch(() => {
          if (alive) setSuggestions([]);
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [nameQuery]);

  const total = useMemo(() => Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100, [lines]);
  const projected = direction === 'credit' ? customerBalance - total : customerBalance + total;
  const hasTypedLine = lines.some((l) => !l.product_id);

  const addLookup = useCallback(
    (lookup: UdhaarItemLookup, qty = 1) => {
      setLines((prev) => {
        const matchIdx = lookup.barcode ? prev.findIndex((l) => l.barcode && l.barcode === lookup.barcode) : -1;
        if (matchIdx >= 0) {
          const next = [...prev];
          next[matchIdx] = { ...next[matchIdx], qty: String(num(next[matchIdx].qty) + qty) };
          return next;
        }
        const rate = priceMode === 'wholesale' ? lookup.wholesale || lookup.retail : lookup.retail || lookup.price;
        return [
          ...prev,
          {
            key: nextKey(),
            product_id: lookup.product_id,
            barcode: lookup.barcode,
            name: lookup.name,
            unit: lookup.unit,
            qty: String(qty),
            rate: String(rate || 0),
            discount: '0',
            batch: lookup.batch,
            expiry: lookup.expiry,
            stock: lookup.source === 'inventory' ? lookup.stock : null,
          },
        ];
      });
    },
    [priceMode]
  );

  async function scan() {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await window.api.udhaar.lookupItem(c);
      if (res.found) {
        addLookup(res);
        setCode('');
      } else {
        setNotFound({
          barcode: c,
          name: '',
          price: '',
          unit: '',
          batch: '',
          expiry: '',
          remember: true,
          addToInventory: false,
        });
        setCode('');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addByName() {
    const q = nameQuery.trim();
    if (!q) return;
    setBusy(true);
    setNotice(null);
    try {
      const results = await window.api.udhaar.searchItems(q);
      const exact = results.find((r) => r.name.toLowerCase() === q.toLowerCase());
      const pick = exact ?? results[0];
      if (pick) {
        addLookup(pick);
        setNameQuery('');
        setSuggestions([]);
      } else {
        setNotFound({
          barcode: null,
          name: q,
          price: '',
          unit: '',
          batch: '',
          expiry: '',
          remember: false,
          addToInventory: false,
        });
        setNameQuery('');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function commitNotFound() {
    if (!notFound || !notFound.name.trim()) return;
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        product_id: null,
        barcode: notFound.barcode,
        name: notFound.name.trim(),
        unit: notFound.unit.trim() || null,
        qty: '1',
        rate: notFound.price.trim() || '0',
        discount: '0',
        batch: notFound.batch.trim() || null,
        expiry: notFound.expiry.trim() || null,
        stock: null,
        remember: notFound.remember,
        add_to_inventory: notFound.addToInventory,
      },
    ]);
    setNotFound(null);
    codeRef.current?.focus();
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function buildInput(overrideUserId?: number | null) {
    const payloadLines: UdhaarEntryLineInput[] = lines
      .filter((l) => l.name.trim() && num(l.qty) > 0)
      .map((l) => ({
        product_id: l.product_id,
        barcode: l.barcode,
        name: l.name.trim(),
        unit: l.unit,
        qty: num(l.qty),
        rate: num(l.rate),
        discount: num(l.discount),
        batch: l.batch,
        expiry: l.expiry,
        remember: l.remember,
        add_to_inventory: l.add_to_inventory,
      }));
    return {
      customer_id: customerId,
      date: date || null,
      note: note.trim() || null,
      reference: reference.trim() || null,
      deduct_stock: deductStock,
      direction,
      lines: payloadLines,
      override_user_id: overrideUserId ?? null,
    };
  }

  async function save(overrideUserId?: number | null) {
    if (busy) return;
    const payload = buildInput(overrideUserId);
    if (payload.lines.length === 0) {
      setNotice('Add at least one item with a quantity.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await window.api.udhaar.createEntry(payload);
      if (res.ok && res.transaction_id) {
        setSavedTxId(res.transaction_id);
        onSaved?.(res.transaction_id);
      } else if (res.blocked) {
        setBlocked({ message: res.message, limit: res.credit_limit, balance: res.current_balance });
        window.api.users
          .list()
          .then((u) => setManagerUsers(u.filter((x) => x.role === 'owner' || x.role === 'manager')))
          .catch(() => setManagerUsers([]));
      } else {
        setNotice(res.message || 'Could not save the entry.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmOverride() {
    if (!pinUserId || !pinSecret) return;
    setBusy(true);
    try {
      const ok = await window.api.auth.verifyForUser(pinUserId, pinSecret);
      if (!ok) {
        setNotice('Incorrect PIN / password.');
        return;
      }
      setBlocked(null);
      setPinSecret('');
      await save(pinUserId);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function printSlip() {
    if (!savedTxId) return;
    setBusy(true);
    try {
      const res = await window.api.udhaar.printEntrySlip(savedTxId, 'thermal80');
      if (!res.ok) setNotice(res.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function shareSlip() {
    if (!savedTxId) return;
    setBusy(true);
    try {
      const res = await window.api.udhaar.shareEntrySlip(savedTxId);
      setNotice(res.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const title =
    savedTxId != null
      ? 'Entry saved'
      : `${direction === 'credit' ? 'Return items' : 'Add Udhaar items'} — ${customerName}`;

  const stockLabel = direction === 'credit' ? 'Return stock to inventory' : 'Deduct stock from inventory';

  return (
    <Modal
      onClose={onClose}
      onSubmit={() => save()}
      title={title}
      className="modal-wide"
      label="Udhaar items"
      shortcuts={[
        { keys: 'Enter', label: 'Scan / add item' },
        { keys: 'Esc', label: 'Close' },
      ]}
    >
      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {savedTxId != null ? (
        <>
          <div className="center" style={{ padding: '18px 8px' }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Saved{total > 0 ? ` — ${formatMoney(total)}` : ''}</div>
            <div className="muted small">
              {direction === 'credit' ? 'Items returned' : 'Udhaar entry recorded'} for {customerName}.
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={printSlip} disabled={busy}>
              Print slip
            </button>
            <button className="btn" onClick={shareSlip} disabled={busy}>
              WhatsApp slip
            </button>
            <button className="btn btn-primary" onClick={onClose} disabled={busy}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          {/* ── Scan bar ─────────────────────────────────────── */}
          <div className="udhaar-scanbar">
            <KeyboardInput
              ref={codeRef}
              type="text"
              decimals={false}
              selectOnFocus={false}
              placeholder="Scan barcode / type SKU, then Enter"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  scan();
                }
              }}
              disabled={busy}
            />
            <input
              list="udhaar-item-names"
              placeholder="…or type an item name"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addByName();
                }
              }}
              disabled={busy}
            />
            <datalist id="udhaar-item-names">
              {suggestions.map((s, i) => (
                <option key={`${s.source}-${s.product_id ?? s.barcode ?? s.name}-${i}`} value={s.name}>
                  {s.source === 'inventory' ? `in stock ${s.stock}` : 'catalog'}
                </option>
              ))}
            </datalist>
            <button className="btn btn-sm" onClick={addByName} disabled={busy || !nameQuery.trim()}>
              Add
            </button>
            <label className="inline-check" title="Price used when scanning an inventory item">
              Price
              <select className="field-select" value={priceMode} onChange={(e) => setPriceMode(e.target.value as 'retail' | 'wholesale')}>
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </label>
          </div>

          {notFound && (
            <div
              className="udhaar-notfound"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitNotFound();
                }
              }}
            >
              <div className="small muted">
                {notFound.barcode ? `Barcode ${notFound.barcode} is not in Inventory or the catalog.` : 'Not found — add it by hand.'}
              </div>
              <div className="udhaar-options">
                <label className="field">
                  <span>Name *</span>
                  <input
                    autoFocus
                    value={notFound.name}
                    onChange={(e) => setNotFound({ ...notFound, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Price</span>
                  <KeyboardInput
                    type="text"
                    value={notFound.price}
                    onChange={(e) => setNotFound({ ...notFound, price: e.target.value })}
                    placeholder="0.00"
                  />
                </label>
                <label className="field">
                  <span>Unit</span>
                  <input value={notFound.unit} onChange={(e) => setNotFound({ ...notFound, unit: e.target.value })} placeholder="Piece" />
                </label>
                <label className="field">
                  <span>Batch</span>
                  <input value={notFound.batch} onChange={(e) => setNotFound({ ...notFound, batch: e.target.value })} />
                </label>
                <label className="field">
                  <span>Expiry</span>
                  <input type="date" value={notFound.expiry} onChange={(e) => setNotFound({ ...notFound, expiry: e.target.value })} />
                </label>
              </div>
              <div className="udhaar-options" style={{ alignItems: 'center' }}>
                {notFound.barcode && (
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={notFound.remember}
                      onChange={(e) => setNotFound({ ...notFound, remember: e.target.checked })}
                    />
                    Remember this barcode
                  </label>
                )}
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={notFound.addToInventory}
                    onChange={(e) => setNotFound({ ...notFound, addToInventory: e.target.checked })}
                  />
                  Also add to Inventory
                </label>
                <button className="btn btn-sm btn-primary" onClick={commitNotFound} disabled={!notFound.name.trim()}>
                  Add line
                </button>
                <button className="btn btn-sm" onClick={() => setNotFound(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Lines grid ───────────────────────────────────── */}
          <div className="table-wrap udhaar-lines">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th className="num">Qty</th>
                  <th>Unit</th>
                  <th className="num">Rate</th>
                  <th className="num">Disc</th>
                  <th className="num">Amount</th>
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <input
                        className="cell-input name"
                        value={l.name}
                        onChange={(e) => updateLine(l.key, { name: e.target.value })}
                      />
                      {l.barcode ? <span className="muted small"> · {l.barcode}</span> : null}
                      {l.stock != null ? <span className="muted small"> · stock {l.stock}</span> : null}
                    </td>
                    <td>
                      <input className="cell-input" value={l.batch ?? ''} onChange={(e) => updateLine(l.key, { batch: e.target.value })} />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        type="date"
                        value={l.expiry ?? ''}
                        onChange={(e) => updateLine(l.key, { expiry: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <KeyboardInput
                        type="text"
                        className="cell-input num"
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <input className="cell-input" value={l.unit ?? ''} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
                    </td>
                    <td className="num">
                      <KeyboardInput
                        type="text"
                        className="cell-input num"
                        value={l.rate}
                        onChange={(e) => updateLine(l.key, { rate: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <KeyboardInput
                        type="text"
                        className="cell-input num"
                        value={l.discount}
                        onChange={(e) => updateLine(l.key, { discount: e.target.value })}
                      />
                    </td>
                    <td className="num">{formatMoney(lineTotal(l))}</td>
                    <td>
                      <button className="btn-icon" title="Remove line" onClick={() => removeLine(l.key)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted center">
                      Scan a barcode or type an item name to begin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Options ──────────────────────────────────────── */}
          <div className="udhaar-options" style={{ alignItems: 'flex-end', marginTop: 8 }}>
            <label className="field">
              <span>Direction</span>
              <select className="field-select" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                <option value="debit">Customer owes me (items taken)</option>
                <option value="credit">I owe customer (items returned)</option>
              </select>
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Reference no.</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </label>
            <label className="inline-check" style={{ paddingBottom: 8 }} title={hasTypedLine ? 'Typed items have no inventory stock to move' : undefined}>
              <input type="checkbox" checked={deductStock} onChange={(e) => setDeductStock(e.target.checked)} />
              {stockLabel}
            </label>
          </div>

          {/* ── Totals ───────────────────────────────────────── */}
          <div className="ledger-summary">
            <div>
              <span className="small muted">Current balance</span>
              <strong>{formatMoney(customerBalance)}</strong>
            </div>
            <div>
              <span className="small muted">This entry</span>
              <strong>{direction === 'credit' ? '-' : '+'}{formatMoney(total)}</strong>
            </div>
            <div>
              <span className="small muted">Balance after</span>
              <strong className={projected > 0 ? 'text-warn' : 'text-ok'}>{formatMoney(projected)}</strong>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => save()} disabled={busy || lines.length === 0}>
              {direction === 'credit' ? 'Save return' : 'Save entry'}
            </button>
          </div>
        </>
      )}

      {/* ── Credit-limit override (manager PIN) ──────────────── */}
      {blocked && (
        <Modal
          onClose={() => setBlocked(null)}
          onSubmit={confirmOverride}
          title="Credit limit exceeded"
          className="modal-sm"
          label="Credit limit override"
          shortcuts={[{ action: 'save', label: 'Override & continue' }]}
        >
          <p>{blocked.message}</p>
          {blocked.limit != null && (
            <p className="muted small">
              Limit {formatMoney(blocked.limit)} · Current {formatMoney(blocked.balance ?? 0)}
            </p>
          )}
          <p className="small">A manager or owner can authorise this entry.</p>
          <label className="field">
            <span>Manager</span>
            <select value={pinUserId ?? ''} onChange={(e) => setPinUserId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select manager</option>
              {managerUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.role})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>PIN / Password</span>
            <input type="password" value={pinSecret} onChange={(e) => setPinSecret(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setBlocked(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={confirmOverride} disabled={busy || !pinUserId || !pinSecret}>
              Override &amp; continue
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
