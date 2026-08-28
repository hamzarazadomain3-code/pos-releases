import { ReactNode } from 'react';

interface FilterRowProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function FilterRow({ children, className = '', style }: FilterRowProps) {
  return (
    <div
      className={`filter-row ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        width: '100%',
        ...(className ? {} : { paddingBottom: 8 }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface FilterBarProps {
  children: ReactNode;
  onClear?: () => void;
  onApply?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  showActions?: boolean;
}

export function FilterBar({
  children,
  onClear,
  onApply,
  isExpanded = true,
  onToggleExpand,
  showActions = true,
}: FilterBarProps) {
  return (
    <div
      className="filter-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        background: '#f8f9fa',
        borderRadius: 8,
        border: '1px solid #e0e0e0',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {children}
      </div>

      {showActions && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid #e0e0e0' }}>
          {onClear && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClear}
            >
              Clear All
            </button>
          )}
          {onApply && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onApply}
            >
              Apply
            </button>
          )}
          {onToggleExpand && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onToggleExpand}
              style={{ marginLeft: 'auto' }}
            >
              {isExpanded ? 'Collapse' : 'Expand'} Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}