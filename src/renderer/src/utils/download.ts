/**
 * Download a byte buffer from the browser.
 *
 * The desktop app saves files through a native dialog in the main process, but
 * the web build has no dialog — the main process hands the bytes back and the
 * renderer triggers the download itself.
 */
export function downloadBytes(
  data: Uint8Array | ArrayBuffer | null | undefined,
  filename: string,
  mime = 'application/octet-stream'
): boolean {
  if (!data) return false;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

export function isDownloadResult(res: unknown): res is Uint8Array {
  return res instanceof Uint8Array;
}
