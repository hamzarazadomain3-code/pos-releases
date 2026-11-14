/**
 * The sidebar brand header — the pure rules.
 *
 * The brand shows the shop's own name (from the Shop Profile) and, when the
 * shop runs more than one branch, the branch it is sitting in. The product
 * name ("Rokar POS") is only the fallback for a shop that has not set a name
 * yet — "Rokar" is never hard-coded into the header.
 */
export const PRODUCT_NAME = 'Rokar POS';

export function brandDisplayName(
  shopName: string | null | undefined,
  productName: string = PRODUCT_NAME
): string {
  const clean = String(shopName ?? '').trim();
  return clean ? clean : productName;
}

export function brandSubtitle(
  multiBranch: boolean | null | undefined,
  branchName: string | null | undefined
): string | null {
  if (!multiBranch) return null;
  const clean = String(branchName ?? '').trim();
  return clean ? clean : null;
}

export function brandInitials(name: string | null | undefined): string {
  const clean = String(name ?? '').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase() || '?';
}
