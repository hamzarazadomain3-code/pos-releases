import { forwardRef, type FocusEvent, type KeyboardEvent } from 'react';
import { KeyboardInput } from './KeyboardInput';

export interface QtyInputProps {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
}

/**
 * Quantity field with −/+ buttons. Arrow keys do NOT step the value (they are
 * left free for cell/row navigation), decimals are allowed, and the value is
 * selected on focus. The −/+ buttons are kept out of the tab order; keyboard
 * users change the value by typing or via the surrounding line-item hook.
 */
export const QtyInput = forwardRef<HTMLInputElement, QtyInputProps>(function QtyInput(
  { value, onChange, min = 1, max = 999, step = 1, disabled, placeholder, className, autoFocus, onKeyDown, onFocus },
  ref,
) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  const bump = (delta: number) => {
    const current = Number(value);
    const base = Number.isFinite(current) ? current : min;
    onChange(String(clamp(base + delta)));
  };

  return (
    <div className={`qty-input-wrap${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="qty-step"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Decrease quantity"
        onClick={() => bump(-step)}
      >
        −
      </button>
      <KeyboardInput
        ref={ref}
        type="text"
        decimals
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        aria-label="Quantity"
      />
      <button
        type="button"
        className="qty-step"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Increase quantity"
        onClick={() => bump(step)}
      >
        +
      </button>
    </div>
  );
});
