import { useState, useRef, useEffect, useMemo } from 'react';

interface Option {
  value: string | number;
  label: string;
}

interface MultiSelectDropdownProps {
  options: Option[];
  value: (string | number)[];
  onChange: (value: (string | number)[]) => void;
  placeholder?: string;
  searchable?: boolean;
  maxDisplay?: number;
  disabled?: boolean;
}

export function MultiSelectDropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchable = true,
  maxDisplay = 3,
  disabled = false,
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    if (!searchable || !searchTerm.trim()) return options;
    const term = searchTerm.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, searchable, searchTerm]);

  const selectedOptions = useMemo(() => {
    return options.filter((o) => value.includes(o.value));
  }, [options, value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (optValue: string | number) => {
    const newValue = value.includes(optValue)
      ? value.filter((v) => v !== optValue)
      : [...value, optValue];
    onChange(newValue);
  };

  const toggleAll = () => {
    if (value.length === options.length) {
      onChange([]);
    } else {
      onChange(options.map((o) => o.value));
    }
  };

  const clearAll = () => onChange([]);

  const displayText = useMemo(() => {
    if (value.length === 0) return placeholder;
    if (value.length <= maxDisplay) {
      return selectedOptions.map((o) => o.label).join(', ');
    }
    return `${value.length} selected`;
  }, [value, selectedOptions, placeholder, maxDisplay]);

  return (
    <div className="multi-select" ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
      <div
        className="field-select multi-select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayText}
        </span>
        <span style={{ marginLeft: 8 }}>{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div
          className="multi-select-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            maxHeight: '280px',
            overflow: 'auto',
            marginTop: 4,
          }}
        >
          {searchable && (
            <input
              type="text"
              placeholder="Search options..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderBottom: '1px solid #eee',
                boxSizing: 'border-box',
              }}
            />
          )}
          <div style={{ padding: '4px 8px', borderBottom: '1px solid #eee', display: 'flex', gap: 8, fontSize: '12px' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={(e) => { e.stopPropagation(); toggleAll(); }}
              style={{ padding: '2px 8px', fontSize: '11px' }}
            >
              {value.length === options.length ? 'Deselect All' : 'Select All'}
            </button>
            {value.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                style={{ padding: '2px 8px', fontSize: '11px' }}
              >
                Clear
              </button>
            )}
          </div>
          <div style={{ maxHeight: '220px', overflow: 'auto' }}>
            {filteredOptions.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                <input
                  type="checkbox"
                  checked={value.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginRight: 8 }}
                />
                {opt.label}
              </label>
            ))}
            {filteredOptions.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
                No options found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}