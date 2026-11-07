import { useEffect, useState } from 'react';
import { formatInputDate, parseInputDate } from '../utils/dateUtils';

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export function DateInput({ value, onChange, className = 'inp', placeholder }: DateInputProps) {
  const [text, setText] = useState(formatInputDate(value));
  useEffect(() => {
    setText(formatInputDate(value));
  }, [value]);

  const commit = (next: string) => {
    const iso = parseInputDate(next);
    if (iso) {
      onChange(iso);
    } else if (next.trim() === '') {
      onChange('');
    } else {
      // Invalid input: revert to the last committed value.
      setText(formatInputDate(value));
    }
  };

  return (
    <input
      className={className}
      type="text"
      placeholder={placeholder || formatInputDate('2000-01-01')}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value);
      }}
    />
  );
}