import type { ReactNode, RefObject } from 'react';
import { Modal } from './Modal';

export interface ModalShellTab {
  id: string;
  label: string;
}

export interface ModalShellProps {
  title: ReactNode;
  tabs: ModalShellTab[];
  /** Controlled active tab id. */
  activeId: string;
  onSelect: (id: string) => void;
  /** Inline error shown above the active tab body. */
  error?: string | null;
  /** The active tab's fields. */
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  className?: string;
  label?: string;
  /** Optional left-aligned line in the footer (e.g. a running total). */
  footerNote?: ReactNode;
  /** Prefer this element for the initial focus (e.g. the first field). */
  initialFocusRef?: RefObject<HTMLElement>;
}

/**
 * A tabbed modal body around the shared `<Modal>` shell.
 *
 * The *parent* owns the active tab and the validation, because only it knows
 * which tab a missing field lives on — this component is just the tab strip plus
 * the ordinary modal chrome, so the keyboard rules (Enter → next/submit, Escape,
 * focus trap) stay exactly the ones `<Modal>` already enforces.
 */
export function ModalShell({
  title,
  tabs,
  activeId,
  onSelect,
  error,
  children,
  onClose,
  onSubmit,
  submitLabel = 'Save',
  className,
  label,
  footerNote,
  initialFocusRef,
}: ModalShellProps) {
  const idx = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  const tab = tabs[idx] ?? tabs[0];

  return (
    <Modal
      onClose={onClose}
      onSubmit={onSubmit}
      title={title}
      className={className}
      label={label}
      initialFocusRef={initialFocusRef}
      shortcuts={[{ action: 'save', label: submitLabel }]}
      actions={{ save: () => onSubmit() }}
    >
      <div className="modal-tabs" role="tablist" aria-label={typeof title === 'string' ? title : 'Sections'}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab?.id}
            className={`modal-tab${t.id === tab?.id ? ' is-active' : ''}`}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="modal-tab-body">
        {error && (
          <div className="notice error" onClick={() => onSelect(activeId)}>
            {error}
          </div>
        )}
        {children}
      </div>

      <div className="modal-actions">
        {footerNote && <div className="modal-actions-note">{footerNote}</div>}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {idx > 0 && (
          <button type="button" className="btn" onClick={() => onSelect(tabs[idx - 1].id)}>
            Back
          </button>
        )}
        {idx < tabs.length - 1 && (
          <button type="button" className="btn" onClick={() => onSelect(tabs[idx + 1].id)}>
            Next
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onSubmit}>
          {submitLabel}
        </button>
      </div>
    </Modal>
  );
}
