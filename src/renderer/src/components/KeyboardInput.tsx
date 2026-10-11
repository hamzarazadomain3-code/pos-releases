import { forwardRef, type InputHTMLAttributes } from 'react';

export interface KeyboardInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 'text' (default) or 'number'. Both accept decimals. */
  type?: 'text' | 'number';
  /** Allow the decimal separator. Default true. */
  decimals?: boolean;
  /** select() the value when the field receives focus. Default true. */
  selectOnFocus?: boolean;
}

/**
 * A drop-in numeric/text input that behaves well on a keyboard:
 *   - ArrowUp / ArrowDown never step the value (they stay navigation keys)
 *   - decimals are allowed
 *   - the value is selected on focus, so typing replaces it
 */
export const KeyboardInput = forwardRef<HTMLInputElement, KeyboardInputProps>(
  function KeyboardInput(
    { type = 'text', decimals = true, selectOnFocus = true, inputMode, onKeyDown, onFocus, ...rest },
    ref,
  ) {
    return (
      <input
        ref={ref}
        type={type}
        inputMode={inputMode ?? (type === 'number' ? 'decimal' : undefined)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
          } else if (!decimals && (e.key === '.' || e.key === ',')) {
            e.preventDefault();
          }
          onKeyDown?.(e);
        }}
        onFocus={(e) => {
          if (selectOnFocus) {
            try {
              e.currentTarget.select();
            } catch {
              /* not selectable */
            }
          }
          onFocus?.(e);
        }}
        {...rest}
      />
    );
  },
);