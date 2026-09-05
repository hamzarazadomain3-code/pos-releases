export const ModalCloseButton = ({ onClose, className = '', 'aria-label': ariaLabel = 'Close' }: { onClose: () => void; className?: string; 'aria-label'?: string }) => (
  <button
    type="button"
    className={`btn btn-icon ${className}`}
    onClick={onClose}
    aria-label={ariaLabel}
    title={ariaLabel}
  >
    ✕
  </button>
);