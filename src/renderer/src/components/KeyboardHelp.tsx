import { useMemo } from 'react';
import { Modal } from './Modal';
import { useActiveScope } from '../keyboard/useActiveScope';
import { GLOBAL_SHORTCUTS, resolveActionKey } from '../keyboard/shortcuts';

interface Row {
  keys: string;
  label: string;
}

/** Keys that work on every list/table, shown as a fixed reference block. */
const NAVIGATION_ROWS: Row[] = [
  { keys: '↑ / ↓', label: 'Move the highlight' },
  { keys: 'Home / End', label: 'First / last item' },
  { keys: 'PgUp / PgDn', label: 'Jump a page' },
  { keys: 'Enter', label: 'Open / select the highlighted item' },
  { keys: 'Delete', label: 'Delete (asks first)' },
  { keys: 'Type letters', label: 'Jump to the search box and filter' },
];

export function KeyboardHelp({
  shortcutMap,
  onClose,
}: {
  shortcutMap: Record<string, string>;
  onClose: () => void;
}) {
  const scope = useActiveScope();

  const screenRows = useMemo<Row[]>(() => {
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const s of scope?.shortcuts ?? []) {
      const keys = s.action ? resolveActionKey(s.action, shortcutMap) : s.keys ?? '';
      const dedupe = `${keys}|${s.label}`;
      if (!keys || seen.has(dedupe)) continue;
      seen.add(dedupe);
      rows.push({ keys, label: s.label });
    }
    return rows;
  }, [scope, shortcutMap]);

  const globalRows = useMemo<Row[]>(
    () =>
      GLOBAL_SHORTCUTS.map((g) => ({
        keys: resolveActionKey(g.id, shortcutMap),
        label: g.label,
      })),
    [shortcutMap],
  );

  return (
    <Modal onClose={onClose} title="Keyboard Shortcuts" className="kb-help" label="Keyboard help">
      <div className="modal-content">
        {scope?.label && (
          <>
            <div className="kb-help-heading">{scope.label}</div>
            {screenRows.length > 0 ? (
              <ShortcutList rows={screenRows} />
            ) : (
              <p className="muted small">No page-specific keys here — the navigation keys below still work.</p>
            )}
          </>
        )}

        <div className="kb-help-heading">Everywhere</div>
        <ShortcutList rows={globalRows} />

        <div className="kb-help-heading">Navigation</div>
        <ShortcutList rows={NAVIGATION_ROWS} />

        <p className="muted small" style={{ marginTop: 12 }}>
          Press <kbd>F1</kbd> any time to see the keys for the screen you are on.
        </p>
      </div>
    </Modal>
  );
}

function ShortcutList({ rows }: { rows: Row[] }) {
  return (
    <div className="kb-help-list">
      {rows.map((r) => (
        <div className="kb-help-row" key={`${r.keys}-${r.label}`}>
          <kbd className="kb-help-key">{r.keys}</kbd>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
