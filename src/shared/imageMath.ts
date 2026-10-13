/**
 * Pure image-upload helpers shared by the main and renderer bundles.
 *
 * Kept free of DOM/canvas APIs so it can be unit-tested from plain Node
 * (`npm run test:imageupload`) while the renderer's `utils/imageUpload.ts`
 * does the actual decode/downscale.
 */

/** Hard ceiling for a picked file before we even try to decode it. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Raster formats we accept. SVG is deliberately excluded: it can carry script
 * payloads and there is no reason a shop needs one for a product photo, a logo
 * or a label image element.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
] as const;

export interface ImageUploadMeta {
  type?: string;
  size?: number;
  name?: string;
}

export type ImageUploadCheck = { ok: true } | { ok: false; reason: string };

export function isAllowedImageType(type?: string | null): boolean {
  if (!type) return false;
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type.toLowerCase());
}

export function formatBytes(n: number): string {
  const size = Number(n);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * Reject a file before we read it. An empty/unknown MIME type is allowed
 * through (some drag sources omit it) — the decoder validates the bytes.
 */
export function validateImageUpload(
  meta: ImageUploadMeta,
  maxBytes: number = MAX_UPLOAD_BYTES,
): ImageUploadCheck {
  const type = (meta.type || '').toLowerCase();
  if (type && !isAllowedImageType(type)) {
    return { ok: false, reason: 'Unsupported image type. Use PNG, JPG, WebP or GIF.' };
  }
  const size = Number(meta.size);
  if (Number.isFinite(size) && size > maxBytes) {
    return {
      ok: false,
      reason: `Image is too large (${formatBytes(size)}). Maximum is ${formatBytes(maxBytes)}.`,
    };
  }
  return { ok: true };
}

/**
 * Scale `width`x`height` down so the longest side is at most `maxDim`.
 * Never enlarges, never returns a zero dimension.
 */
export function fitWithin(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const max = Math.max(1, Math.round(Number(maxDim) || 1));
  if (w <= max && h <= max) return { width: w, height: h };
  const scale = max / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
