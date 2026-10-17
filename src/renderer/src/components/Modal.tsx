import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useFormKeyboard } from '../hooks/useFormKeyboard';
import { useKeyboardScope } from '../hooks/useKeyboardScope';
import { ModalCloseButton } from './ModalCloseButton';
import type { ScopeShortcut } from '../keyboard/scopeRegistry';

export interface ModalProps {
  /** Close the modal. Wired to Escape, the × button and an overlay click. */
  onClose: () => void;
  /** Primary action — Enter on the last field triggers this. */
  onSubmit?: () => void;
  /** Rendered as the modal header. Omit to supply your own markup. */
  title?: ReactNode;
  children: ReactNode;
  /** Rendered in `.modal-footer`. */
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
  overlayStyle?: CSSProperties;
  /**
   * Extra keydown handler that runs BEFORE the built-in form logic (Enter →
   * next/submit, Escape → close, Tab focus trap). Call `e.preventDefault()` to
   * claim the key and stop the built-in handling — e.g. a modal that must confirm
   * on Enter from any field rather than only the last one.
   */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Prefer this element for the initial focus. */
  initialFocusRef?: RefObject<HTMLElement>;
  closeOnOverlay?: boolean;
  showClose?: boolean;
  /**
   * Window-style minimize / maximize buttons in the header. They follow the
   * close button: a modal that hides `showClose` (a mandatory decision dialog)
   * hides these too, so it cannot be deferred or covered.
   */
  showWindowControls?: boolean;
  /** Entries shown in the F1 overlay while this modal is open. */
  shortcuts?: ScopeShortcut[];
  /**
   * Admin action id → handler, so a documented combo actually does something
   * here (e.g. `{ save: onSubmit }` wires Ctrl+S to submit).
   */
  actions?: Record<string, (e: KeyboardEvent) => void>;
  label?: string;
}

const MinimizeIcon = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const MaximizeIcon = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const RestoreIcon = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <rect x="1.6" y="3.9" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M4.1 3.9V3.1a1 1 0 0 1 1-1h4.2a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1h-.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

/**
 * Shared modal shell: focus trap, Enter→next/submit, Escape to close, first
 * field focused on open, and a registered modal keyboard scope so page-level
 * shortcuts are masked while it is open.
 *
 * The header also carries window-style controls: **maximize** expands the panel
 * to fill the viewport, **minimize** docks it to a small bar in the corner and
 * hands the keyboard back to the page (the modal scope and form-keyboard logic
 * are withdrawn while docked, so the cashier can keep working and restore it by
 * clicking the bar). The form stays mounted, so no typed value is lost.
 */
export function Modal({
  onClose,
  onSubmit,
  title,
  children,
  footer,
  className,
  style,
  overlayStyle,
  onKeyDown: onKeyDownProp,
  initialFocusRef,
  closeOnOverlay = true,
  showClose = true,
  showWindowControls = true,
  shortcuts,
  actions,
  label,
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const { onKeyDown } = useFormKeyboard({
    containerRef: boxRef,
    onSubmit,
    onCancel: onClose,
    initialFocusRef,
    // While docked the user is working on the page underneath — do not trap keys.
    enabled: !minimized,
  });

  useKeyboardScope({
    kind: 'modal',
    onEscape: onClose,
    shortcuts,
    actions,
    label,
    // A docked modal must not mask the page's own keyboard scope.
    enabled: !minimized,
  });

  const controls = showClose && showWindowControls;

  return (
    <div
      className={`modal-overlay${minimized ? ' modal-overlay-minimized' : ''}`}
      style={overlayStyle}
      onClick={closeOnOverlay && !minimized ? onClose : undefined}
    >
      <div
        ref={boxRef}
        className={
          `modal${className ? ` ${className}` : ''}` +
          `${maximized ? ' modal-maximized' : ''}` +
          `${minimized ? ' modal-minimized' : ''}`
        }
        style={style}
        role="dialog"
        aria-modal={minimized ? 'false' : 'true'}
        data-minimized={minimized ? 'true' : undefined}
        data-maximized={maximized ? 'true' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          // Clicking anywhere on a docked bar (other than its buttons) restores it.
          if (minimized && !(e.target as HTMLElement).closest('button')) setMinimized(false);
        }}
        onKeyDown={(e) => {
          if (minimized) return;
          onKeyDownProp?.(e);
          onKeyDown(e);
        }}
      >
        {title !== undefined && (
          <div className="modal-header">
            <h3 className={minimized ? 'modal-title-docked' : undefined}>
              {minimized ? (
                <>
                  <span className="modal-docked-hint">Minimized</span>
                  <span className="modal-title-text">{title}</span>
                </>
              ) : (
                title
              )}
            </h3>
            <div className="modal-window-actions">
              {controls && (
                <>
                  <button
                    type="button"
                    className="modal-win-btn"
                    aria-label={minimized ? 'Restore' : 'Minimize'}
                    title={minimized ? 'Restore' : 'Minimize'}
                    onClick={() =>
                      setMinimized((m) => {
                        if (!m) setMaximized(false);
                        return !m;
                      })
                    }
                  >
                    <MinimizeIcon />
                  </button>
                  <button
                    type="button"
                    className="modal-win-btn"
                    aria-label={maximized && !minimized ? 'Restore' : 'Maximize'}
                    title={maximized && !minimized ? 'Restore' : 'Maximize'}
                    onClick={() => {
                      setMinimized(false);
                      setMaximized((m) => !m);
                    }}
                  >
                    {maximized && !minimized ? <RestoreIcon /> : <MaximizeIcon />}
                  </button>
                </>
              )}
              {showClose && <ModalCloseButton onClose={onClose} />}
            </div>
          </div>
        )}
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
