import { useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useListKeyboard } from '../hooks/useListKeyboard';

export interface PalettePage {
  key: string;
  label: string;
}

export function CommandPalette({
  pages,
  onNavigate,
  onClose,
}: {
  pages: PalettePage[];
  onNavigate: (key: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
  }, [pages, query]);

  const list = useListKeyboard({
    count: filtered.length,
    loop: true,
    onOpen: (i) => {
      const page = filtered[i];
      if (page) onNavigate(page.key);
    },
  });

  const choose = (index?: number) => {
    const page = typeof index === 'number' ? filtered[index] : filtered[list.activeIndex >= 0 ? list.activeIndex : 0];
    if (page) onNavigate(page.key);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      list.setActiveIndex((prev) => {
        const current = prev < 0 ? 0 : prev;
        const next = current + 1;
        return filtered.length ? next % filtered.length : -1;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      list.setActiveIndex((prev) => {
        const current = prev < 0 ? 0 : prev;
        return filtered.length ? (current - 1 + filtered.length) % filtered.length : -1;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      choose();
    }
  };

  return (
    <Modal
      onClose={onClose}
      className="command-palette"
      label="Command palette"
      initialFocusRef={inputRef}
      shortcuts={[{ action: 'command_palette', label: 'Open the command palette' }]}
    >
      <div className="modal-content">
        <input
          ref={inputRef}
          className="search-input palette-search"
          placeholder="Go to page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label="Search pages"
        />
        <div className="palette-list" {...list.getContainerProps()}>
          {filtered.length === 0 && <div className="palette-empty muted">No matching page</div>}
          {filtered.map((p, i) => (
            <button
              key={p.key}
              type="button"
              className={`palette-item${i === list.activeIndex ? ' active' : ''}`}
              {...list.getRowProps(i)}
              onClick={() => onNavigate(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
