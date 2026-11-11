import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { KeyboardInput } from './KeyboardInput';
import { validateQuickCustomer, type QuickCustomerDraft } from '@shared/quickCustomer';
import type { Customer } from '../../../shared/types';

export interface QuickCustomerDialogProps {
  /** The customers already loaded by the page (for the duplicate warning). */
  existing: Customer[];
  /** Prefilled text (e.g. what the cashier typed in the combobox). */
  initialName?: string;
  initialPhone?: string;
  onClose: () => void;
  /** Called after the customer was created through the real service. */
  onCreated: (customer: Customer) => void;
  /** "Open full form" — opens the full customer modal with these values. */
  onOpenFullForm?: (draft: QuickCustomerDraft) => void;
  /** Max discount percent the shop allows (Settings). */
  maxDiscountPercent?: number;
}

/**
 * The quick "New Customer" dialog.
 *
 * Fast by default: Name (autofocus) and Phone, with a collapsed "More details"
 * that remembers whether it was open. Enter moves to the next field,
 * Ctrl+Enter saves, Esc cancels. A duplicate phone/name is a WARNING with a
 * "Use existing customer" hint, not a hard error.
 */
export default function QuickCustomerDialog({
  existing,
  initialName = '',
  initialPhone = '',
  onClose,
  onCreated,
  onOpenFullForm,
  maxDiscountPercent = 100,
}: QuickCustomerDialogProps) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [whatsapp, setWhatsapp] = useState('');
  const [sameAsPhone, setSameAsPhone] = useState(true);
  const [customerType, setCustomerType] = useState('retail');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [minBill, setMinBill] = useState('');
  const [priceLevel, setPriceLevel] = useState<'retail' | 'wholesale'>('retail');
  const [creditLimit, setCreditLimit] = useState('');
  const [creditDays, setCreditDays] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // "More details" remembers whether it was open.
  const moreKey = 'quickCustomer.moreOpen';
  useEffect(() => {
    try {
      if (localStorage.getItem(moreKey) === '1') setMoreOpen(true);
    } catch {
      /* ignore */
    }
  }, []);
  const toggleMore = () => {
    setMoreOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(moreKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const draft: QuickCustomerDraft = useMemo(
    () => ({
      name,
      phone,
      whatsapp: sameAsPhone ? phone : whatsapp,
      customer_type: customerType,
      discount_type: discountType,
      discount_value: discountValue,
      discount_min_bill: minBill,
      price_level: priceLevel,
      credit_limit: creditLimit,
      credit_days: creditDays,
      opening_balance: openingBalance,
      notes,
    }),
    [
      name,
      phone,
      whatsapp,
      sameAsPhone,
      customerType,
      discountType,
      discountValue,
      minBill,
      priceLevel,
      creditLimit,
      creditDays,
      openingBalance,
      notes,
    ]
  );

  const validation = useMemo(
    () => validateQuickCustomer(draft, existing as any),
    [draft, existing]
  );

  const save = async () => {
    setError(null);
    setDuplicate(null);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (discountType === 'percent' && Number(discountValue || 0) > maxDiscountPercent) {
      setError(`A percent discount cannot be more than ${maxDiscountPercent}%.`);
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.customers.save(
        {
          name: validation.cleaned.name,
          phone: validation.cleaned.phone,
          whatsapp: validation.cleaned.whatsapp,
          customer_type: validation.cleaned.customer_type,
          default_discount_pct: validation.cleaned.discount_value,
          discount_type: validation.cleaned.discount_type,
          discount_min_bill: validation.cleaned.discount_min_bill,
          price_level: validation.cleaned.price_level,
          credit_limit: validation.cleaned.credit_limit,
          credit_days: validation.cleaned.credit_days,
          opening_balance: validation.cleaned.opening_balance,
          notes: validation.cleaned.notes,
        },
        null
      );
      if (!res.ok) {
        setError(res.message ?? 'Could not save the customer.');
        return;
      }
      if (res.customer) onCreated(res.customer);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      onSubmit={save}
      title="New customer"
      className="modal-narrow"
      initialFocusRef={nameRef}
      shortcuts={[{ action: 'save', label: 'Save customer' }]}
      onKeyDown={(e) => {
        // Ctrl+Enter saves from any field.
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          void save();
        }
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>Name *</span>
          <KeyboardInput
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name"
          />
        </label>
        <label className="field">
          <span>Phone</span>
          <KeyboardInput
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="03XXXXXXXXX"
          />
        </label>

        <div className="field span-2">
          <button type="button" className="btn btn-sm" onClick={toggleMore}>
            {moreOpen ? '▾' : '▸'} More details
          </button>
        </div>

        {moreOpen && (
          <>
            <label className="field">
              <span>WhatsApp</span>
              <KeyboardInput
                value={sameAsPhone ? phone : whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                disabled={sameAsPhone}
                placeholder="Same as phone"
              />
              <label className="inline-check" style={{ marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={sameAsPhone}
                  onChange={(e) => setSameAsPhone(e.target.checked)}
                />
                Same as phone
              </label>
            </label>
            <label className="field">
              <span>Customer type</span>
              <select value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
                <option value="shop">Shop</option>
                <option value="medical">Medical store</option>
                <option value="other">Other</option>
              </select>
            </label>
            <div className="field span-2">
              <span>Default discount</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                  style={{ width: '90px' }}
                >
                  <option value="percent">%</option>
                  <option value="fixed">Rs</option>
                </select>
                <KeyboardInput
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <label className="field">
              <span>Apply only if bill is at least (Rs)</span>
              <KeyboardInput
                value={minBill}
                onChange={(e) => setMinBill(e.target.value)}
                placeholder="0 = always"
                decimals
              />
            </label>
            <label className="field">
              <span>Price level</span>
              <select
                value={priceLevel}
                onChange={(e) => setPriceLevel(e.target.value as 'retail' | 'wholesale')}
              >
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </label>
            <label className="field">
              <span>Credit limit (Rs)</span>
              <KeyboardInput
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="0"
                decimals
              />
            </label>
            <label className="field">
              <span>Credit days</span>
              <KeyboardInput
                value={creditDays}
                onChange={(e) => setCreditDays(e.target.value)}
                placeholder="0"
                decimals
              />
            </label>
            <label className="field">
              <span>Opening balance (Rs)</span>
              <KeyboardInput
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0.00"
                decimals
              />
              <span className="muted small">Positive = the customer owes you.</span>
            </label>
            <label className="field span-2">
              <span>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </label>
          </>
        )}
      </div>

      {validation.duplicate && (
        <div className="notice" style={{ marginTop: 10 }}>
          {validation.duplicate.message}{' '}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setDuplicate(validation.duplicate?.message ?? null);
            }}
          >
            Use existing customer
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      <div className="modal-actions">
        {onOpenFullForm && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onOpenFullForm(draft)}
          >
            Open full form
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save customer'}
        </button>
      </div>
    </Modal>
  );
}
