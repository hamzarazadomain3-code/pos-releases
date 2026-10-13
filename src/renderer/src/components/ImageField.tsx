import { useRef, useState, type ChangeEvent } from 'react';
import { readImageFile } from '../utils/imageUpload';

export interface ImageFieldProps {
  /** Current value: a data URL, an http(s) URL, or a path. */
  value: string;
  onChange: (value: string) => void;
  /** Longest side after downscaling, in px. Defaults to 1024. */
  maxDim?: number;
  /** JPEG quality for photos (0–1). Defaults to 0.85. */
  quality?: number;
  /** Also show a text box for a URL / path (kept for existing workflows). */
  allowUrl?: boolean;
  urlPlaceholder?: string;
  buttonText?: string;
  /** Small helper line under the control. */
  hint?: string;
  /** Reject the file outright (message shown inline). Overrides the default. */
  validate?: (file: File) => string | null;
  previewClassName?: string;
  accept?: string;
  disabled?: boolean;
}

/**
 * One consistent "pick an image from this PC" control: an Upload button, an
 * optional URL/path box, a thumbnail preview and Remove.
 *
 * The file is validated and downscaled by `readImageFile` before `onChange`,
 * so the stored value is never a multi-megabyte data URL.
 */
export function ImageField({
  value,
  onChange,
  maxDim = 1024,
  quality = 0.85,
  allowUrl = false,
  urlPlaceholder = 'Image URL / path',
  buttonText = 'Upload from PC',
  hint,
  validate,
  previewClassName = 'image-preview',
  accept = 'image/png,image/jpeg,image/webp,image/gif',
  disabled = false,
}: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires a change.
    e.target.value = '';
    if (!file) return;
    if (validate) {
      const problem = validate(file);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError('');
    setBusy(true);
    try {
      onChange(await readImageFile(file, { maxDim, quality }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.');
    } finally {
      setBusy(false);
    }
  };

  const isDataUrl = value.startsWith('data:');
  const showPreview = isDataUrl || /^https?:|^file:|^[\\/]|^\.{1,2}[\\/]|^[a-z]:[\\/]/i.test(value);

  return (
    <div className="image-field">
      {allowUrl && (
        <input
          type="text"
          className="image-field-url"
          value={isDataUrl ? '' : value}
          placeholder={isDataUrl ? 'Uploaded image in use' : urlPlaceholder}
          onChange={(e) => {
            setError('');
            onChange(e.target.value);
          }}
          disabled={disabled}
        />
      )}

      <div className="image-field-row">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy ? 'Reading…' : buttonText}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          disabled={disabled || busy}
          onChange={pick}
        />
        {value && (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => {
              setError('');
              onChange('');
            }}
            disabled={disabled}
          >
            Remove
          </button>
        )}
      </div>

      {value && showPreview && (
        <img src={value} alt="Preview" className={previewClassName} />
      )}
      {value && !showPreview && <span className="muted small">{value}</span>}
      {hint && <span className="muted small image-field-hint">{hint}</span>}
      {error && <span className="image-field-error">{error}</span>}
    </div>
  );
}
