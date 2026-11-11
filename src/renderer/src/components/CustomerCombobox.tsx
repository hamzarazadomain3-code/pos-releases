import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterCustomers,
  type CustomerSearchItem,
  type CustomerSearchRow,
} from '@shared/customerSearch';
import { getCurrencySymbol } from '../utils/currency';

export interface CustomerComboboxProps {
  customers: CustomerSearchItem[];
  /** The selected customer id ('' = walk-in / cash). */
  value: string;
  onChange: (id: string) => void;
  /** Called when the cashier picks "+ New customer" (the typed text comes along). */
  onNewCustomer?: (query: string) => void;
  /** Focus + open the combobox from anywhere (F6). */
  openSignal?: number;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * A searchable customer combobox (F6).
 *
 * Filters by name, phone or customer code (case-insensitive, Urdu names
 * included). Every row shows the balance ("due 120"), the customer's saved
 * discount ("5%" / "Rs 50 off") and a warning marker when the customer is
 * over their credit limit. The first entry is "No customer (Cash)" and the
 * last row is "+ New customer".
 *
 * Up/Down move, Enter selects (and returns the focus to the caller),
 * Esc closes without a change, Tab behaves like Enter.
 */
export default function CustomerCombobox({
  customers,
  value,
  onChange,
  onNewCustomer,
  openSignal,
  placeholder = 'Customer… (F6)',
  disabled,
  autoFocus,
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const rows: CustomerSearchRow[] = useMemo(
    () => filterCustomers(customers, query, 50, getCurrencySymbol()),
    [customers, query]
  );

  // The list is: "No customer (Cash)" + the matches + "+ New customer".
  const itemCount = rows.length + 2;

  useEffect(() => {
    if (openSignal === undefined) return;
    if (!open) {
      setOpen(true);
      setActiveIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const select = (index: number) => {
    if (index === 0) {
      onChange('');
      setOpen(false);
      setQuery('');
      return;
    }
    if (index === rows.length + 1) {
      onNewCustomer?.(query);
      setOpen(false);
      setQuery('');
      return;
    }
    const row = rows[index - 1];
    if (row) onChange(String(row.customer.id));
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % itemCount);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + itemCount) % itemCount);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      select(activeIndex);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  };

  const selected = customers.find((c) => String(c.id) === String(value));

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="field-select"
        style={{ maxWidth: 200, minWidth: 140 }}
        placeholder={placeholder}
        value={open ? query : selected ? selected.name : ''}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActiveIndex(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls="customer-combobox-list"
        aria-autocomplete="list"
      />
      {open && (
        <div
          id="customer-combobox-list"
          className="product-search-dropdown"
          role="listbox"
          style={{ position: 'absolute', zIndex: 60, minWidth: 260, maxHeight: '50vh', overflowY: 'auto' }}
        >
          <button
            type="button"
            role="option"
            aria-selected={activeIndex === 0}
            className={`product-search-result${activeIndex === 0 ? ' active' : ''}`}
            onMouseEnter={() => setActiveIndex(0)}
            onClick={() => select(0)}
          >
            <span className="psr-name">No customer (Cash)</span>
          </button>
          {rows.map((row, i) => (
            <button
              key={row.customer.id}
              type="button"
              role="option"
              aria-selected={activeIndex === i + 1}
              className={`product-search-result${activeIndex === i + 1 ? ' active' : ''}`}
              onMouseEnter={() => setActiveIndex(i + 1)}
              onClick={() => select(i + 1)}
            >
              <span className="psr-name">
                {row.customer.name}
                {row.overLimit && (
                  <span className="badge badge-danger" style={{ marginLeft: 6 }} title="Over credit limit">
                    over limit
                  </span>
                )}
              </span>
              <span className="psr-meta">
                {row.balanceLabel}
                {row.discountLabel ? ` · ${row.discountLabel}` : ''}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={activeIndex === rows.length + 1}
            className={`product-search-result${activeIndex === rows.length + 1 ? ' active' : ''}`}
            onMouseEnter={() => setActiveIndex(rows.length + 1)}
            onClick={() => select(rows.length + 1)}
          >
            <span className="psr-name">+ New customer</span>
          </button>
        </div>
      )}
    </div>
  );
}
