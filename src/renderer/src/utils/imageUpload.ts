import { fitWithin, validateImageUpload, MAX_UPLOAD_BYTES } from '@shared/imageMath';

export interface ReadImageOptions {
  /** Longest side of the stored image, in px. Defaults to 1024. */
  maxDim?: number;
  /** JPEG quality (0–1) for photos. Defaults to 0.85. */
  quality?: number;
  /** Override the hard size ceiling (bytes). */
  maxBytes?: number;
  /**
   * Re-encode whenever the image is larger than this many bytes, even if it
   * fits within `maxDim`. Keeps a 100KB+ logo from sitting in localStorage.
   */
  reencodeAboveBytes?: number;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not a readable image.'));
    img.src = src;
  });
}

/** Formats that carry an alpha channel and must stay PNG after a resize. */
const ALPHA_TYPES = /png|webp|gif/i;

/**
 * Turn a picked `File` into a data URL, downscaling large photos so a shop
 * photo does not bloat the SQLite row or blow the localStorage quota that
 * Label Studio templates live in.
 *
 * Throws an `Error` with a human-readable message on anything unusable.
 */
export async function readImageFile(file: File, opts: ReadImageOptions = {}): Promise<string> {
  const maxDim = opts.maxDim ?? 1024;
  const quality = opts.quality ?? 0.85;
  const reencodeAbove = opts.reencodeAboveBytes ?? 200 * 1024;

  const check = validateImageUpload(
    { type: file.type, size: file.size, name: file.name },
    opts.maxBytes ?? MAX_UPLOAD_BYTES,
  );
  if (!check.ok) throw new Error(check.reason);

  const original = await readAsDataUrl(file);
  if (!original.startsWith('data:')) throw new Error('That file is not an image.');

  // Dimensions give us both the resize target and a validity check.
  let natural: { width: number; height: number };
  try {
    const img = await loadImage(original);
    natural = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  } catch {
    throw new Error('That file is not a readable image.');
  }
  if (!natural.width || !natural.height) {
    // Decoded but dimensionless (some SVGs) — keep the original bytes untouched.
    return original;
  }

  const fit = fitWithin(natural.width, natural.height, maxDim);
  const resized = fit.width !== natural.width || fit.height !== natural.height;
  if (!resized && file.size <= reencodeAbove) return original;

  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.drawImage(await loadImage(original), 0, 0, fit.width, fit.height);

  try {
    return ALPHA_TYPES.test(file.type)
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', quality);
  } catch {
    // Tainted canvas / unsupported encoder — the untouched original still works.
    return original;
  }
}
