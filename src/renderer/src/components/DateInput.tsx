import { useEffect, useState } from 'react';
import { formatInputDate } from '../utils/dateUtils';

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

  return (
    <input
      className={className}
      type="text"
      placeholder={placeholder || formatInputDate('2000-01-01').replace(/[0-9]/g, '#')}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        // Let the parent own parsing in places where ISO is needed:
        // try ISO first, otherwise keep whatever was typed.
        onChange(v);
      }}
      onBlur={() => {
        setText(formatInputDate(value));
      }}
    />
  );
}
