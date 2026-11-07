import type { LabelHTMLAttributes, ReactNode } from 'react';

interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  label?: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, required, children, className, ...rest }: FieldProps) {
  return (
    <label className={`field${className ? ' ' + className : ''}`} {...rest}>
      {label !== undefined && (
        <span>
          {label}
          {required ? ' *' : ''}
        </span>
      )}
      {children}
      {hint && <span className="muted small" style={{ display: 'block', marginTop: 4 }}>{hint}</span>}
    </label>
  );
}
