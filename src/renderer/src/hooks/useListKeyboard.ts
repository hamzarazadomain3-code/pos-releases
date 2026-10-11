import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface UseListKeyboardOptions {
  /** Number of rows currently rendered. */
  count: number;
  /** Enter on the active row. */
  onOpen?: (index: number) => void;
  /** Delete on the active row (caller confirms). */
  onDelete?: (index: number) => void;
  /**
   * A printable character was typed while a row had focus. The caller should
   * focus its search box and apply the character (programmatically — the
   * browser does not insert it because no text input had focus).
   */
  onFilterChar?: (char: string) => void;
  enabled?: boolean;
  loop?: boolean;
  pageSize?: number;
}

export interface RowKeyboardProps {
  ref: (el: any) => void;
  tabIndex: number;
  'data-kb-active': 'true' | undefined;
  onFocus: () => void;
  onMouseDown: () => void;
}

export interface ContainerKeyboardProps {
  ref: (el: any) => void;
  tabIndex: number;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * Arrow-key / Enter / Delete navigation for any result list or data table.
 *
 * Usage:
 *   const list = useListKeyboard({ count: rows.length, onOpen, onDelete });
 *   <div {...list.getContainerProps()}>
 *     <table>
 *       <tbody>
 *         {rows.map((r, i) => <tr key={r.id} {...list.getRowProps(i)}>…</tr>)}
 */
export function useListKeyboard({
  count,
  onOpen,
  onDelete,
  onFilterChar,
  enabled = true,
  loop = false,
  pageSize = 10,
}: UseListKeyboardOptions) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);

  // Keep the active row inside the list as rows appear/disappear.
  useEffect(() => {
    setActiveIndex((i) => {
      if (count === 0) return -1;
      if (i < 0) return i;
      return Math.min(i, count - 1);
    });
  }, [count]);

  const focusRow = useCallback((index: number) => {
    const el = rowRefs.current[index];
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }, []);

  const moveTo = useCallback(
    (index: number) => {
      setActiveIndex(index);
      focusRow(index);
    },
    [focusRow],
  );

  const clampIndex = useCallback(
    (index: number) => {
      if (count === 0) return -1;
      if (loop) return ((index % count) + count) % count;
      return Math.max(0, Math.min(count - 1, index));
    },
    [count, loop],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled || count === 0) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const interactive =
      tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A';
    const current = activeIndex < 0 ? 0 : activeIndex;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(clampIndex(current + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(clampIndex(current - 1));
        return;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        return;
      case 'End':
        e.preventDefault();
        moveTo(count - 1);
        return;
      case 'PageDown':
        e.preventDefault();
        moveTo(clampIndex(current + pageSize));
        return;
      case 'PageUp':
        e.preventDefault();
        moveTo(clampIndex(current - pageSize));
        return;
      case 'Enter':
        // A focused button/link inside the row owns Enter.
        if (interactive) return;
        if (activeIndex >= 0) {
          e.preventDefault();
          onOpen?.(activeIndex);
        }
        return;
      case 'Delete':
        if (interactive) return;
        if (activeIndex >= 0) {
          e.preventDefault();
          onDelete?.(activeIndex);
        }
        return;
      default:
        break;
    }

    if (
      onFilterChar &&
      !interactive &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      /\S/.test(e.key)
    ) {
      onFilterChar(e.key);
    }
  };

  const getRowProps = (index: number): RowKeyboardProps => ({
    ref: (el) => {
      rowRefs.current[index] = el;
    },
    tabIndex: -1,
    'data-kb-active': index === activeIndex ? 'true' : undefined,
    onFocus: () => setActiveIndex(index),
    onMouseDown: () => setActiveIndex(index),
  });

  const getContainerProps = (): ContainerKeyboardProps => ({
    ref: (el) => {
      containerRef.current = el;
    },
    tabIndex: 0,
    onKeyDown,
  });

  return { activeIndex, setActiveIndex, containerRef, focusRow, getRowProps, getContainerProps };
}
