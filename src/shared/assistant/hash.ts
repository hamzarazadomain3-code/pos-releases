/**
 * A small, dependency-free content hash.
 *
 * The assistant's activity log stores a HASH of what was sent — never the
 * text itself — so the owner can see that something was asked without the
 * shop's data (or a secret) ending up in the log.
 *
 * It is a plain FNV-1a: it is not a security hash, it only has to tell two
 * different questions apart.
 */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  const value = String(text ?? '');
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // A second round with the length, so "ab" and "ab " differ.
  let hash2 = 0x811c9dc5 ^ value.length;
  hash2 = Math.imul(hash2, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0') + hash2.toString(16).padStart(8, '0');
}
