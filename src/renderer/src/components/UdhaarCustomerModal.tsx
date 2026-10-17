import { useMemo, useRef, useState } from 'react';
import type { Customer, CustomerInput, CustomerDuplicates } from '../../../shared/types';
import { ModalShell, type ModalShellTab } from './ModalShell';
import { KeyboardInput } from './KeyboardInput';
import { ImageField } from './ImageField';
import { getCurrencySymbol } from '../utils/currency';

export interface UdhaarCustomerModalProps {
  /** Present when editing; omit to add. */
  customer?: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
  /** Duplicate found → jump to that existing customer. */
  onOpenExisting?: (id: number) => void;
}

type FormState = Record<keyof CustomerInput, string>;

const EMPTY: FormState = {
  name: '',
  phone: '',
  address: '',
  urdu_name: '',
  customer_type: 'retail',
  business_name: '',
  contact_person: '',
  photo: '',
  status: 'active',
  customer_code: '',
  group_name: '',
  tags: '',
  phone_alt: '',
  whatsapp: '',
  email: '',
  city: '',
  area: '',
  maps_link: '',
  message_language: 'en',
  cnic: '',
  ntn: '',
  drug_licence: '',
  guarantor: '',
  guarantor_phone: '',
  credit_limit: '',
  credit_days: '',
  price_level: 'retail',
  default_discount_pct: '',
  credit_action: 'warn',
  max_single_bill: '',
  opening_balance: '',
  opening_balance_as_of: '',
  notes: '',
  birthday: '',
  anniversary: '',
  reminder_freq: 'none',
};

const TABS: ModalShellTab[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'contact', label: 'Contact' },
  { id: 'identity', label: 'Identity & Tax' },
  { id: 'credit', label: 'Credit' },
  { id: 'notes', label: 'Notes' },
];

function numStr(x: number | null | undefined): string {
  return x == null || x === 0 ? '' : String(x);
}

function numOr(v: string, fallback: number): number {
  const s = v.trim();
  if (!s) return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalise a typed phone to PK digits: +92 300… / 92 300… / 0300… → 0300… */
function pkDigits(v: string): string {
  return v.replace(/\D/g, '').replace(/^92/, '0');
}

function phoneError(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const d = pkDigits(s);
  if (!/^03\d{9}$/.test(d)) return 'Phone should be 11 digits starting 03 (e.g. 03001234567).';
  return null;
}

function emailError(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? null : 'Email does not look valid.';
}

/** PK CNIC: 13 digits, optionally dashed as 5-7-1 (35202-1234567-1). */
function cnicError(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  return /^\d{5}-?\d{7}-?\d$/.test(s) ? null : 'CNIC should be 13 digits (e.g. 35202-1234567-1).';
}

function seedFrom(c: Customer): FormState {
  return {
    ...EMPTY,
    name: c.name ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    urdu_name: c.urdu_name ?? '',
    customer_type: c.customer_type ?? 'retail',
    business_name: c.business_name ?? '',
    contact_person: c.contact_person ?? '',
    photo: c.photo ?? '',
    status: c.status ?? 'active',
    customer_code: c.customer_code ?? '',
    group_name: c.group_name ?? '',
    tags: c.tags ?? '',
    phone_alt: c.phone_alt ?? '',
    whatsapp: c.whatsapp ?? '',
    email: c.email ?? '',
    city: c.city ?? '',
    area: c.area ?? '',
    maps_link: c.maps_link ?? '',
    message_language: c.message_language ?? 'en',
    cnic: c.cnic ?? '',
    ntn: c.ntn ?? '',
    drug_licence: c.drug_licence ?? '',
    guarantor: c.guarantor ?? '',
    guarantor_phone: c.guarantor_phone ?? '',
    credit_limit: numStr(c.credit_limit),
    credit_days: numStr(c.credit_days),
    price_level: c.price_level ?? 'retail',
    default_discount_pct: numStr(c.default_discount_pct),
    credit_action: c.credit_action ?? (c.block_on_exceed ? 'block' : 'warn'),
    max_single_bill: numStr(c.max_single_bill),
    opening_balance: '',
    opening_balance_as_of: c.opening_balance_as_of ?? '',
    notes: c.notes ?? '',
    birthday: c.birthday ?? '',
    anniversary: c.anniversary ?? '',
    reminder_freq: c.reminder_freq ?? 'none',
  };
}

/**
 * The tabbed Add / Edit customer form (Phase 3). Five tabs, in-place validation
 * that jumps to the offending tab, and a duplicate phone/name prompt that offers
 * to open the existing customer instead of creating a second one.
 */
export function UdhaarCustomerModal({ customer, onClose, onSaved, onOpenExisting }: UdhaarCustomerModalProps) {
  const editing = !!customer;
  const [form, setForm] = useState<FormState>(() => (customer ? seedFrom(customer) : { ...EMPTY }));
  const initialRef = useRef(form);
  const [activeId, setActiveId] = useState('basic');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<CustomerDuplicates | null>(null);
  const [dupAck, setDupAck] = useState(false);
  const [sameWhatsapp, setSameWhatsapp] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof CustomerInput, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setPhone = (value: string) =>
    setForm((f) => ({ ...f, phone: value, whatsapp: sameWhatsapp ? value : f.whatsapp }));

  const isMedical = form.customer_type === 'medical';

  const setOf = (key: keyof CustomerInput): ((v: string) => void) => (v) => set(key, v);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  /** ×/Escape/Cancel — confirm before throwing away typed changes. */
  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm('Discard the changes to this customer?')) return;
    onClose();
  }

  function validateTab(id: string): string | null {
    if (id === 'basic') {
      if (!form.name.trim()) return 'Customer name is required.';
    }
    if (id === 'contact') {
      const p = phoneError(form.phone);
      if (p) return p;
      const w = phoneError(form.whatsapp);
      if (w && !sameWhatsapp) return 'WhatsApp number should be 11 digits starting 03.';
      const e = emailError(form.email);
      if (e) return e;
    }
    if (id === 'identity') {
      const c = cnicError(form.cnic);
      if (c) return c;
      const g = phoneError(form.guarantor_phone);
      if (g) return 'Guarantor phone should be 11 digits starting 03.';
    }
    if (id === 'credit') {
      const notNegative: Array<[string, string]> = [
        [form.credit_limit, 'Credit limit'],
        [form.credit_days, 'Credit days'],
        [form.max_single_bill, 'Max single bill'],
      ];
      for (const [v, label] of notNegative) {
        if (v.trim() && numOr(v, 0) < 0) return `${label} cannot be negative.`;
      }
      const d = numOr(form.default_discount_pct, 0);
      if (form.default_discount_pct.trim() && (d < 0 || d > 100)) return 'Default discount must be between 0 and 100.';
    }
    return null;
  }

  async function persist() {
    setBusy(true);
    setError(null);
    try {
      const payload: CustomerInput = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        urdu_name: form.urdu_name.trim() || null,
        customer_type: form.customer_type,
        business_name: form.business_name.trim() || null,
        contact_person: form.contact_person.trim() || null,
        photo: form.photo || null,
        status: form.status,
        customer_code: form.customer_code.trim() || null,
        group_name: form.group_name.trim() || null,
        tags: form.tags.trim() || null,
        phone_alt: form.phone_alt.trim() || null,
        whatsapp: (sameWhatsapp ? form.phone : form.whatsapp).trim() || null,
        email: form.email.trim() || null,
        city: form.city.trim() || null,
        area: form.area.trim() || null,
        maps_link: form.maps_link.trim() || null,
        message_language: form.message_language,
        cnic: form.cnic.trim() || null,
        ntn: form.ntn.trim() || null,
        drug_licence: form.drug_licence.trim() || null,
        guarantor: form.guarantor.trim() || null,
        guarantor_phone: form.guarantor_phone.trim() || null,
        credit_limit: numOr(form.credit_limit, 0),
        credit_days: numOr(form.credit_days, 0),
        price_level: form.price_level,
        default_discount_pct: numOr(form.default_discount_pct, 0),
        credit_action: form.credit_action,
        max_single_bill: numOr(form.max_single_bill, 0),
        opening_balance: numOr(form.opening_balance, 0),
        opening_balance_as_of: form.opening_balance_as_of || null,
        notes: form.notes.trim() || null,
        birthday: form.birthday || null,
        anniversary: form.anniversary || null,
        reminder_freq: form.reminder_freq,
      };
      const res = await window.api.customers.save(payload, customer?.id ?? null);
      if (res.ok && res.customer) {
        onSaved(res.customer);
      } else {
        setError(res.message || 'Could not save the customer.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (busy) return;
    for (const t of TABS) {
      const err = validateTab(t.id);
      if (err) {
        setActiveId(t.id);
        setError(err);
        return;
      }
    }
    setError(null);
    if (!dupAck) {
      setBusy(true);
      try {
        const dups = await window.api.customers.findDuplicates({
          phone: form.phone.trim() || null,
          name: form.name.trim(),
          excludeId: customer?.id ?? null,
        });
        if (dups.phone.length > 0 || dups.name.length > 0) {
          setDuplicates(dups);
          setBusy(false);
          return;
        }
      } catch {
        // A failed duplicate check must never block a legitimate save.
      }
      setBusy(false);
    }
    await persist();
  }

  async function saveAnyway() {
    setDupAck(true);
    setDuplicates(null);
    await persist();
  }

  const dupList = useMemo(() => {
    if (!duplicates) return [] as Customer[];
    const seen = new Set<number>();
    return [...duplicates.phone, ...duplicates.name].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [duplicates]);

  const title = editing ? `Edit ${customer?.name}` : 'Add Customer';

  return (
    <ModalShell
      title={title}
      tabs={TABS}
      activeId={activeId}
      onSelect={(id) => {
        setActiveId(id);
        setError(null);
      }}
      error={error}
      onClose={requestClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? 'Save Changes' : 'Save Customer'}
      className="modal-lg"
      label="Customer"
      initialFocusRef={nameRef}
      footerNote={
        editing && customer ? (
          <span className="muted small">
            Balance: {getCurrencySymbol()}
            {Number(customer.balance || 0).toFixed(2)}
          </span>
        ) : undefined
      }
    >
      {duplicates && (
        <div className="notice error udhaar-dup">
          <div>
            A customer with this {duplicates.phone.length ? 'phone number' : 'name'} already exists:
          </div>
          <ul>
            {dupList.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.phone ? ` · ${c.phone}` : ''}
                {onOpenExisting && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      onOpenExisting(c.id);
                      onClose();
                    }}
                  >
                    Open existing
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <button type="button" className="btn btn-sm" onClick={() => setDuplicates(null)}>
              Keep editing
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={saveAnyway} disabled={busy}>
              Save anyway
            </button>
          </div>
        </div>
      )}

      {/* ── Basic ─────────────────────────────────────────── */}
      {activeId === 'basic' && (
        <div className="form-grid">
          <label className="field span-2">
            <span>Name *</span>
            <input ref={nameRef} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field">
            <span>Urdu name</span>
            <input value={form.urdu_name} onChange={(e) => set('urdu_name', e.target.value)} dir="rtl" />
          </label>
          <label className="field">
            <span>Customer type</span>
            <select value={form.customer_type} onChange={(e) => set('customer_type', e.target.value)}>
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="medical">Medical store</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">
            <span>Shop / business</span>
            <input value={form.business_name} onChange={(e) => set('business_name', e.target.value)} />
          </label>
          <label className="field">
            <span>Contact person</span>
            <input value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
          </label>
          <label className="field">
            <span>Status</span>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="field">
            <span>Customer code</span>
            <input value={form.customer_code} onChange={(e) => set('customer_code', e.target.value)} placeholder="Optional" />
          </label>
          <label className="field">
            <span>Group</span>
            <input value={form.group_name} onChange={(e) => set('group_name', e.target.value)} placeholder="e.g. Market" />
          </label>
          <label className="field">
            <span>Tags</span>
            <input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="comma, separated" />
          </label>
          <label className="field span-2">
            <span>Photo</span>
            <ImageField value={form.photo} onChange={setOf('photo')} maxDim={512} hint="Optional — shown on the profile." />
          </label>
        </div>
      )}

      {/* ── Contact ───────────────────────────────────────── */}
      {activeId === 'contact' && (
        <div className="form-grid">
          <label className="field">
            <span>Phone *</span>
            <input value={form.phone} onChange={(e) => setPhone(e.target.value)} placeholder="03001234567" inputMode="tel" autoFocus={!editing} />
          </label>
          <label className="field">
            <span>Alternate phone</span>
            <input value={form.phone_alt} onChange={(e) => set('phone_alt', e.target.value)} inputMode="tel" />
          </label>
          <label className="field">
            <span>WhatsApp</span>
            <input
              value={sameWhatsapp ? form.phone : form.whatsapp}
              onChange={(e) => set('whatsapp', e.target.value)}
              placeholder="03001234567"
              inputMode="tel"
              disabled={sameWhatsapp}
            />
          </label>
          <label className="field">
            <span>&nbsp;</span>
            <span className="inline-check">
              <input
                type="checkbox"
                checked={sameWhatsapp}
                onChange={(e) => {
                  const on = e.target.checked;
                  setSameWhatsapp(on);
                  if (on) set('whatsapp', form.phone);
                }}
              />
              Same as phone
            </span>
          </label>
          <label className="field">
            <span>Email</span>
            <input value={form.email} onChange={(e) => set('email', e.target.value)} inputMode="email" />
          </label>
          <label className="field">
            <span>Message language</span>
            <select value={form.message_language} onChange={(e) => set('message_language', e.target.value)}>
              <option value="en">English</option>
              <option value="ur">Urdu</option>
            </select>
          </label>
          <label className="field span-2">
            <span>Address</span>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </label>
          <label className="field">
            <span>City</span>
            <input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label className="field">
            <span>Area</span>
            <input value={form.area} onChange={(e) => set('area', e.target.value)} />
          </label>
          <label className="field span-2">
            <span>Maps link</span>
            <input value={form.maps_link} onChange={(e) => set('maps_link', e.target.value)} placeholder="https://maps.google.com/…" />
          </label>
        </div>
      )}

      {/* ── Identity & Tax ────────────────────────────────── */}
      {activeId === 'identity' && (
        <div className="form-grid">
          <label className="field">
            <span>CNIC</span>
            <input value={form.cnic} onChange={(e) => set('cnic', e.target.value)} placeholder="35201-1234567-1" />
          </label>
          <label className="field">
            <span>NTN / STRN</span>
            <input value={form.ntn} onChange={(e) => set('ntn', e.target.value)} />
          </label>
          <label className="field">
            <span>Drug licence {isMedical ? '' : '(medical only)'}</span>
            <input
              value={form.drug_licence}
              onChange={(e) => set('drug_licence', e.target.value)}
              disabled={!isMedical}
              placeholder={isMedical ? 'Licence no.' : 'Set type to Medical store'}
            />
          </label>
          <label className="field">
            <span>Reference / guarantor</span>
            <input value={form.guarantor} onChange={(e) => set('guarantor', e.target.value)} />
          </label>
          <label className="field">
            <span>Guarantor phone</span>
            <input value={form.guarantor_phone} onChange={(e) => set('guarantor_phone', e.target.value)} inputMode="tel" />
          </label>
        </div>
      )}

      {/* ── Credit ────────────────────────────────────────── */}
      {activeId === 'credit' && (
        <div className="form-grid">
          <label className="field">
            <span>Credit limit ({getCurrencySymbol()})</span>
            <KeyboardInput value={form.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} placeholder="0 = no limit" />
          </label>
          <label className="field">
            <span>Credit days</span>
            <KeyboardInput value={form.credit_days} onChange={(e) => set('credit_days', e.target.value)} placeholder="0 = never overdue" />
          </label>
          <label className="field">
            <span>When over limit</span>
            <select value={form.credit_action} onChange={(e) => set('credit_action', e.target.value)}>
              <option value="warn">Warn only</option>
              <option value="block">Block the sale (Yes)</option>
              <option value="allow">Allow — never warn or block (No)</option>
            </select>
          </label>
          <label className="field">
            <span>Price level</span>
            <select value={form.price_level} onChange={(e) => set('price_level', e.target.value)}>
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
            </select>
          </label>
          <label className="field">
            <span>Default discount (%)</span>
            <KeyboardInput value={form.default_discount_pct} onChange={(e) => set('default_discount_pct', e.target.value)} placeholder="0" />
          </label>
          <label className="field">
            <span>Max single bill ({getCurrencySymbol()})</span>
            <KeyboardInput value={form.max_single_bill} onChange={(e) => set('max_single_bill', e.target.value)} placeholder="0 = no cap" />
          </label>
          <label className="field">
            <span>Opening balance ({getCurrencySymbol()})</span>
            <KeyboardInput
              value={form.opening_balance}
              onChange={(e) => set('opening_balance', e.target.value)}
              placeholder="0.00"
              disabled={editing}
              title={editing ? 'Opening balance is set when the customer is created.' : undefined}
            />
          </label>
          <label className="field">
            <span>Opening as of</span>
            <input
              type="date"
              value={form.opening_balance_as_of}
              onChange={(e) => set('opening_balance_as_of', e.target.value)}
            />
          </label>
          <div className="field span-2">
            <span className="muted small">
              Opening balance: positive = the customer owes you (Dr); negative = you owe the customer (Cr).
              {editing && ' Edit it in the ledger instead.'}
            </span>
          </div>
        </div>
      )}

      {/* ── Notes ─────────────────────────────────────────── */}
      {activeId === 'notes' && (
        <div className="form-grid">
          <label className="field span-2">
            <span>Notes</span>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
          </label>
          <label className="field">
            <span>Birthday</span>
            <input type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} />
          </label>
          <label className="field">
            <span>Anniversary</span>
            <input type="date" value={form.anniversary} onChange={(e) => set('anniversary', e.target.value)} />
          </label>
          <label className="field">
            <span>Reminder</span>
            <select value={form.reminder_freq} onChange={(e) => set('reminder_freq', e.target.value)}>
              <option value="none">No reminder</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
      )}
    </ModalShell>
  );
}
