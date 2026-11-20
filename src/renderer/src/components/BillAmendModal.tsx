import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ModalShell, type ModalShellTab } from './ModalShell';
import { Field } from './Field';
import CustomerCombobox from './CustomerCombobox';
import {
  amendMoney,
  amendRound2,
  normalizeSplit,
  splitTotal,
  type BillAmendSplit,
} from '@shared/billAmend';
import { formatMoney } from '../utils/currency';
import type { BillAmendResult, BillAmendView, Customer } from '../../../shared/types';

/**
 * "Amend bill" — the one screen that changes a FINISHED bill.
 *
 * The service (`billAmendments.ts`) owns every rule: who may amend, the reason,
 * the credit limit, the transaction. This component only collects the fields and
 * shows the before → after numbers, so the cashier can see exactly what will move
 * before saving. A refusal from the service is shown verbatim — the UI never
 * pretends an amendment succeeded.
 */

const TABS: ModalShellTab[] = [
  { id: 'customer', label: 'Customer' },
  { id: 'payments', label: 'Payments & Udhaar' },
  { id: 'notes', label: 'Notes' },
  { id: 'returns', label: 'Return items' },
  { id: 'reprint', label: 'Reprint' },
];

export interface BillAmendModalProps {
  saleId: number;
  /** The invoice number, so the title is right even before the view loads. */
  invoiceNo: string;
  /** `owner` / `manager` / `cashier` — decides whether the PIN box is shown. */
  role: string | null;
  customers: Customer[];
  onClose: () => void;
  onSaved: (result: BillAmendResult) => void;
  /** Hand the bill to the Returns page (the cart return path is the one that restocks). */
  onReturnItems: (saleId: number) => void;
  /** Reprint with the DUPLICATE COPY + AMENDED stamps. */
  onReprint: (saleId: number) => void;
}

function splitFromView(view: BillAmendView | null): BillAmendSplit {
  return normalizeSplit(view?.split);
}

export function BillAmendModal({
  saleId,
  invoiceNo,
  role,
  customers,
  onClose,
  onSaved,
  onReturnItems,
  onReprint,
}: BillAmendModalProps) {
  const [view, setView] = useState<BillAmendView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState('customer');

  const [customerId, setCustomerId] = useState('');
  const [overrideCreditLimit, setOverrideCreditLimit] = useState(false);
  const [split, setSplit] = useState<BillAmendSplit>({ cash: 0, card: 0, bank: 0, credit: 0 });
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [managerPin, setManagerPin] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set once the service accepted an amendment; the history refreshes with it. */
  const [amended, setAmended] = useState<BillAmendResult | null>(null);

  const reasonRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const fresh = await window.api.billAmend.getView(saleId);
      if (!fresh) {
        setLoadError('This bill no longer exists.');
        return;
      }
      setView(fresh);
      setCustomerId(fresh.customerId == null ? '' : String(fresh.customerId));
      setSplit(splitFromView(fresh));
      setNotes(fresh.notes ?? '');
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [saleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isOwner = role === 'owner';
  const needsPin = !isOwner;
  const blocked = view ? !view.allowed : false;

  const beforeSplit = splitFromView(view);
  const afterSplit = normalizeSplit(split);
  const enteredTotal = splitTotal(split);
  const billTotal = amendRound2(view?.total ?? 0);
  const splitMatches = Math.abs(enteredTotal - billTotal) < 0.005;

  const cashEffect = amendRound2(afterSplit.cash - beforeSplit.cash);
  const creditEffect = amendRound2(afterSplit.credit - beforeSplit.credit);

  const selectedCustomer = useMemo(
    () => (customerId ? customers.find((c) => String(c.id) === customerId) ?? null : null),
    [customerId, customers]
  );
  const customerChanged = (view?.customerId == null ? '' : String(view.customerId)) !== customerId;
  const notesChanged = (view?.notes ?? '') !== notes;

  const needsMoneyChange =
    amendRound2(afterSplit.cash) !== amendRound2(beforeSplit.cash) ||
    amendRound2(afterSplit.card) !== amendRound2(beforeSplit.card) ||
    amendRound2(afterSplit.bank) !== amendRound2(beforeSplit.bank) ||
    amendRound2(afterSplit.credit) !== amendRound2(beforeSplit.credit);

  const canSaveTab = tab === 'customer' || tab === 'payments' || tab === 'notes';

  const submitLabel =
    tab === 'customer' ? 'Save Customer' : tab === 'payments' ? 'Save Split' : tab === 'notes' ? 'Save Notes' : 'Close';

  const submit = useCallback(async () => {
    if (!view || blocked) return;
    if (!canSaveTab) return;
    setError(null);

    if (!reason.trim()) {
      setError('A reason is required for every amendment.');
      reasonRef.current?.focus();
      return;
    }
    if (needsPin && !managerPin.trim()) {
      setError('Enter your PIN again to amend a bill.');
      return;
    }
    if (tab === 'payments' && !splitMatches) {
      setError(
        `The split must add up to ${formatMoney(billTotal)} — it currently adds up to ${formatMoney(enteredTotal)}.`
      );
      return;
    }
    if (tab === 'customer' && !customerChanged) {
      setError('Pick a different customer — or use the Notes tab for a correction.');
      return;
    }
    if (tab === 'notes' && !notesChanged) {
      setError('The notes are unchanged.');
      return;
    }

    setBusy(true);
    try {
      const pin = needsPin ? managerPin.trim() : undefined;
      const base = { saleId, reason: reason.trim(), managerPin: pin };
      const result =
        tab === 'customer'
          ? await window.api.billAmend.customer({
              ...base,
              customerId: customerId === '' ? null : Number(customerId),
              overrideCreditLimit: isOwner && overrideCreditLimit,
            })
          : tab === 'payments'
            ? await window.api.billAmend.payments({ ...base, split: normalizeSplit(split) })
            : await window.api.billAmend.notes({ ...base, notes });

      setAmended(result);
      setReason('');
      setManagerPin('');
      setOverrideCreditLimit(false);
      await reload();
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    view,
    blocked,
    canSaveTab,
    reason,
    needsPin,
    managerPin,
    tab,
    splitMatches,
    billTotal,
    enteredTotal,
    customerChanged,
    notesChanged,
    saleId,
    customerId,
    isOwner,
    overrideCreditLimit,
    split,
    notes,
    reload,
    onSaved,
  ]);

  /** Ctrl+Enter saves from any tab — the chord the strict run pins. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey && (e.key === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    }
  };

  const title = `Amend Bill — ${view?.invoiceNo ?? invoiceNo}`;
  const loading = !view && !loadError;

  return (
    <ModalShell
      title={title}
      tabs={TABS}
      activeId={tab}
      onSelect={(id) => {
        setTab(id);
        setError(null);
      }}
      error={error ?? loadError}
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel={submitLabel}
      className="modal-wide"
      label="Amend bill"
      footerNote={
        <span className="muted small">
          Ctrl+Enter saves · Esc closes
          {view && view.amendedCount > 0 ? ` · amended ${view.amendedCount}×` : ''}
        </span>
      }
      initialFocusRef={reasonRef}
      onKeyDown={onKeyDown}
      hideActions={loading || blocked || !canSaveTab}
    >
      {loading && <div className="muted center">Loading the bill…</div>}

      {view && blocked && (
        <div className="notice error" data-testid="amend-blocked">
          {view.blockedReason ?? 'This bill cannot be amended right now.'}
        </div>
      )}

      {view && !blocked && (
        <>
          <div className="amend-summary" data-testid="amend-summary">
            <div>
              <strong>{view.invoiceNo}</strong>
              <span className="muted small"> · {view.customerName ?? 'Walk-in'}</span>
            </div>
            <div className="amend-summary-money">
              Total <strong>{formatMoney(view.total)}</strong>
              <span className="muted small"> · paid {formatMoney(view.total - view.credit)}</span>
              <span className={view.credit > 0 ? 'text-warn' : 'muted'}>
                {' '}
                · udhaar {formatMoney(view.credit)}
              </span>
            </div>
          </div>

          {tab === 'customer' && (
            <div className="amend-tab-body">
              <Field label="Customer" hint="Moving the bill moves its udhaar (and its ledger rows) with it.">
                <CustomerCombobox
                  customers={customers}
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="Walk-in (no customer)"
                />
              </Field>
              {isOwner && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={overrideCreditLimit}
                    onChange={(e) => setOverrideCreditLimit(e.target.checked)}
                  />
                  <span>Go over the customer&apos;s credit limit (owner only)</span>
                </label>
              )}
            </div>
          )}

          {tab === 'payments' && (
            <div className="amend-tab-body">
              <p className="muted small">
                State the whole split — cash, card, bank and udhaar together. It must add up to the bill total;
                the bill&apos;s original payment rows are never rewritten, so a closed shift stays correct.
              </p>
              <div className="amend-split-grid">
                {(['cash', 'card', 'bank', 'credit'] as const).map((mode) => (
                  <label className="field" key={mode}>
                    <span>{mode === 'credit' ? 'Udhaar (credit)' : mode[0].toUpperCase() + mode.slice(1)}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={String(split[mode])}
                      data-testid={`amend-split-${mode}`}
                      onChange={(e) =>
                        setSplit((prev) => ({ ...prev, [mode]: amendMoney(e.target.value) }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div
                className={`amend-split-total ${splitMatches ? 'text-ok' : 'text-warn'}`}
                data-testid="amend-split-total"
              >
                Adds up to {formatMoney(enteredTotal)} of {formatMoney(billTotal)}
                {splitMatches ? ' ✓' : ` — ${formatMoney(Math.abs(billTotal - enteredTotal))} left`}
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div className="amend-tab-body">
              <Field label="Notes / remarks" hint="Printed on the amended copy and kept in the amendment history.">
                <textarea
                  rows={4}
                  value={notes}
                  data-testid="amend-notes"
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. customer called — address corrected"
                />
              </Field>
            </div>
          )}

          {tab === 'returns' && (
            <div className="amend-tab-body">
              <p className="muted">
                A return is its own counter. It restocks the item, refunds the price actually paid and is
                subtracted from today&apos;s sales exactly once.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="amend-open-returns"
                onClick={() => onReturnItems(saleId)}
              >
                Open Return / Refund for {view.invoiceNo}
              </button>
            </div>
          )}

          {tab === 'reprint' && (
            <div className="amend-tab-body">
              <p className="muted">
                The reprint carries <strong>DUPLICATE COPY</strong> and <strong>AMENDED</strong> (with the
                amendment count) so it can never be mistaken for the original.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="amend-reprint"
                onClick={() => onReprint(saleId)}
              >
                Print amended copy
              </button>
            </div>
          )}

          {tab === 'payments' && (
            <div className="amend-preview" data-testid="amend-preview">
              <div className="amend-preview-title">Before → After</div>
              <div className="amend-preview-row">
                <span>Cash</span>
                <span>{formatMoney(beforeSplit.cash)}</span>
                <span>→</span>
                <span>{formatMoney(afterSplit.cash)}</span>
              </div>
              <div className="amend-preview-row">
                <span>Card</span>
                <span>{formatMoney(beforeSplit.card)}</span>
                <span>→</span>
                <span>{formatMoney(afterSplit.card)}</span>
              </div>
              <div className="amend-preview-row">
                <span>Bank</span>
                <span>{formatMoney(beforeSplit.bank)}</span>
                <span>→</span>
                <span>{formatMoney(afterSplit.bank)}</span>
              </div>
              <div className="amend-preview-row">
                <span>Udhaar</span>
                <span>{formatMoney(beforeSplit.credit)}</span>
                <span>→</span>
                <span>{formatMoney(afterSplit.credit)}</span>
              </div>
              <div className="amend-preview-row amend-preview-effect">
                <span>Drawer</span>
                <span style={{ gridColumn: '2 / -1' }} className={cashEffect === 0 ? 'muted' : cashEffect > 0 ? 'text-ok' : 'text-warn'}>
                  {cashEffect === 0 ? 'no change' : `${cashEffect > 0 ? '+' : ''}${formatMoney(cashEffect)}`}
                </span>
              </div>
              <div className="amend-preview-row amend-preview-effect">
                <span>Customer ledger</span>
                <span style={{ gridColumn: '2 / -1' }} className={creditEffect === 0 ? 'muted' : creditEffect > 0 ? 'text-warn' : 'text-ok'}>
                  {creditEffect === 0 ? 'no change' : `${creditEffect > 0 ? '+' : ''}${formatMoney(creditEffect)}`}
                </span>
              </div>
              {!needsMoneyChange && <div className="muted small">The split is unchanged.</div>}
            </div>
          )}

          {tab === 'customer' && customerChanged && (
            <div className="amend-preview" data-testid="amend-preview">
              <div className="amend-preview-title">Before → After</div>
              <div className="amend-preview-row">
                <span>Customer</span>
                <span>{view.customerName ?? 'Walk-in'}</span>
                <span>→</span>
                <span>{selectedCustomer?.name ?? 'Walk-in'}</span>
              </div>
              {view.credit > 0 && (
                <div className="amend-preview-row amend-preview-effect">
                  <span>Udhaar moves</span>
                  <span style={{ gridColumn: '2 / -1' }} className="text-warn">
                    {formatMoney(view.credit)} from {view.customerName ?? 'Walk-in'} to{' '}
                    {selectedCustomer?.name ?? 'Walk-in'}
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === 'notes' && notesChanged && (
            <div className="amend-preview" data-testid="amend-preview">
              <div className="amend-preview-title">Before → After</div>
              <div className="amend-preview-row amend-preview-notes">
                <span className="muted">{view.notes || '—'}</span>
                <span>→</span>
                <span>{notes || '—'}</span>
              </div>
            </div>
          )}

          <div className="amend-reason">
            <Field label="Reason (required)" hint="Stored on the amendment and in the activity log.">
              <input
                ref={reasonRef}
                value={reason}
                data-testid="amend-reason"
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. customer only had part of the cash"
              />
            </Field>
            {needsPin && view.allowManager && (
              <Field label="Manager PIN" hint="A manager re-enters their own PIN for every amendment.">
                <input
                  type="password"
                  value={managerPin}
                  data-testid="amend-pin"
                  onChange={(e) => setManagerPin(e.target.value)}
                  placeholder="••••"
                />
              </Field>
            )}
          </div>

          {amended && (
            <div className="notice" data-testid="amend-saved">
              Saved. Cash {amended.cashEffect >= 0 ? '+' : ''}
              {formatMoney(amended.cashEffect)} · udhaar {amended.creditEffect >= 0 ? '+' : ''}
              {formatMoney(amended.creditEffect)}.
            </div>
          )}

          <div className="amend-history">
            <div className="amend-preview-title">Amendment history</div>
            {view.amendments.length === 0 && <div className="muted small">No amendments yet.</div>}
            {view.amendments.map((a) => (
              <div className="amend-history-row" key={a.id} data-testid="amend-history-row">
                <span className="muted small">{a.createdAt}</span>
                <span>{a.reason}</span>
                <span className="muted small">
                  {a.username ?? '—'} · {a.kind}
                </span>
              </div>
            ))}
          </div>

          {busy && <div className="muted small">Saving…</div>}
        </>
      )}
    </ModalShell>
  );
}

export default BillAmendModal;
