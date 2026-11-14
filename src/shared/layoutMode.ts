/**
 * The layout mode — phone, tablet or desktop.
 *
 * One rule, read from the viewport width:
 *   phone   < 768 px
 *   tablet  768 .. 1023 px
 *   desktop >= 1024 px
 *
 * A width that is missing, NaN, zero or negative is treated as "desktop" —
 * the desktop layout is the most capable one, so an unknown width never
 * hides the menu.
 */
export type LayoutMode = 'phone' | 'tablet' | 'desktop';

export const BREAKPOINT_PHONE = 768;
export const BREAKPOINT_TABLET = 1024;

export function layoutModeFor(width: number | null | undefined): LayoutMode {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 'desktop';
  if (w < BREAKPOINT_PHONE) return 'phone';
  if (w < BREAKPOINT_TABLET) return 'tablet';
  return 'desktop';
}

export function isPhone(width: number | null | undefined): boolean {
  return layoutModeFor(width) === 'phone';
}

export function isTablet(width: number | null | undefined): boolean {
  return layoutModeFor(width) === 'tablet';
}

export function isDesktop(width: number | null | undefined): boolean {
  return layoutModeFor(width) === 'desktop';
}
