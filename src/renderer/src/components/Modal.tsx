import {
  useRef,
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
  /** Entries shown in the F1 overlay while this modal is open. */
  shortcuts?: ScopeShortcut[];
  label?: string;
}

/**
 * Shared modal shell: focus trap, Enter→next/submit, Escape to close, first
 * field focused on open, and a registered modal keyboard scope so page-level
 * shortcuts are masked while it is open.
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
  shortcuts,
  label,
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  const { onKeyDown } = useFormKeyboard({
    containerRef: boxRef,
    onSubmit,
    onCancel: onClose,
    initialFocusRef,
  });

  useKeyboardScope({ kind: 'modal', onEscape: onClose, shortcuts, label });

  return (
    <div
      className="modal-overlay"
      style={overlayStyle}
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <div
        ref={boxRef}
        className={`modal${className ? ` ${className}` : ''}`}
        style={style}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          onKeyDownProp?.(e);
          onKeyDown(e);
        }}
      >
        {title !== undefined && (
          <div className="modal-header">
            <h3>{title}</h3>
            {showClose && <ModalCloseButton onClose={onClose} />}
          </div>
        )}
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
