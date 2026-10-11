import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface UseLineItemKeyboardOptions {
  /** Number of item rows. */
  rowCount: number;
  /** Ordered column keys, e.g. ['product', 'qty', 'price']. */
  columns: string[];
  /** Ctrl+Delete (or Delete on an empty cell) removes the row. */
  onRemoveRow?: (row: number) => void;
  /** Ctrl+Enter, or Enter past the last cell. */
  onSubmit?: () => void;
  /** Escape. */
  onCancel?: () => void;
  /** Called whenever focus enters a cell — e.g. to open a product dropdown. */
  onCellFocus?: (row: number, column: string) => void;
  /**
   * Enter on the last column of the last row. Return true to signal it was
   * handled (e.g. "add a new blank row") and suppress onSubmit.
   */
  onAdvancePastEnd?: () => boolean;
  enabled?: boolean;
}

export interface CellKeyboardProps {
  ref: (el: any) => void;
  'data-kb-cell': string;
  onFocus: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * Keyboard model for line-item tables: a search → qty → price cycle, arrowing
 * between rows, Enter to advance, Shift+Enter to go back, Ctrl+Enter to submit,
 * Delete to drop a row and Escape to cancel.
 *
 * Cell elements register themselves via getCellProps(row, column) — the hook
 * only handles navigation and intent; the page owns the data model.
 */
export function useLineItemKeyboard({
  rowCount,
  columns,
  onRemoveRow,
  onSubmit,
  onCancel,
  onCellFocus,
  onAdvancePastEnd,
  enabled = true,
}: UseLineItemKeyboardOptions) {
  const [cell, setCell] = useState<{ row: number; col: number } | null>(null);
  const cells = useRef<Map<string, HTMLElement>>(new Map());

  const cellKey = (row: number, col: number) => `${row}:${col}`;

  const focusCell = useCallback(
    (row: number, col: number) => {
      if (rowCount <= 0) return;
      const r = Math.max(0, Math.min(rowCount - 1, row));
      const c = Math.max(0, Math.min(columns.length - 1, col));
      setCell({ row: r, col: c });
      onCellFocus?.(r, columns[c]);
      const el = cells.current.get(cellKey(r, c));
      if (el) {
        el.focus();
        el.scrollIntoView?.({ block: 'nearest' });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowCount, columns, onCellFocus],
  );

  // Keep the active cell inside the table as rows change.
  useEffect(() => {
    if (!cell) return;
    if (rowCount === 0) {
      setCell(null);
      return;
    }
    if (cell.row >= rowCount) {
      focusCell(rowCount - 1, cell.col);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount]);

  const advance = (row: number, col: number, dir: 1 | -1): boolean => {
    let r = row;
    let c = col + dir;
    if (c >= columns.length) {
      c = 0;
      r += 1;
    } else if (c < 0) {
      c = columns.length - 1;
      r -= 1;
    }
    if (r < 0 || r >= rowCount) return false;
    focusCell(r, c);
    return true;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>, row: number, col: number) => {
    if (!enabled) return;
    const target = e.target as HTMLInputElement | null;
    const key = e.key;

    if (key === 'Escape') {
      if (onCancel) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      return;
    }

    if (key === 'Enter') {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        onSubmit?.();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        advance(row, col, -1);
        return;
      }
      const atEnd = row === rowCount - 1 && col === columns.length - 1;
      if (atEnd) {
        if (onAdvancePastEnd?.()) return;
        onSubmit?.();
        return;
      }
      advance(row, col, 1);
      return;
    }

    if (key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      advance(row, col, e.shiftKey ? -1 : 1);
      return;
    }

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      focusCell(row + (key === 'ArrowDown' ? 1 : -1), col);
      return;
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      // Only leave the field when the caret is already at the boundary, so
      // normal text editing keeps working.
      if (!target || typeof target.selectionStart !== 'number') return;
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const atEnd =
        target.selectionStart === (target.value?.length ?? 0) &&
        target.selectionEnd === (target.value?.length ?? 0);
      if (key === 'ArrowRight' && atEnd) {
        e.preventDefault();
        e.stopPropagation();
        advance(row, col, 1);
      } else if (key === 'ArrowLeft' && atStart) {
        e.preventDefault();
        e.stopPropagation();
        advance(row, col, -1);
      }
      return;
    }

    if (key === 'Delete' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      onRemoveRow?.(row);
    }
  };

  const getCellProps = (row: number, col: number): CellKeyboardProps => ({
    ref: (el) => {
      const k = cellKey(row, col);
      if (el) cells.current.set(k, el);
      else cells.current.delete(k);
    },
    'data-kb-cell': `${row}:${columns[col]}`,
    onFocus: () => {
      setCell({ row, col });
      onCellFocus?.(row, columns[col]);
    },
    onKeyDown: (e) => onKeyDown(e, row, col),
  });

  return { cell, setCell, focusCell, getCellProps };
}
