/**
 * THE icon set — one definition, drawn as plain SVG shapes.
 *
 * The icons live here (not in the renderer) for two reasons:
 *   1. the menu, the phone drawer, the tablet rail, the bottom bar and the
 *      Ctrl+K search all read the SAME icon for a page — there is no second
 *      list of icons anywhere;
 *   2. the shape data is testable without a browser, so a duplicated icon
 *      (two pages wearing the same picture) can never come back unnoticed.
 *
 * Every icon is a list of SVG child shapes on a 0 0 24 24 grid. The renderer
 * wraps them in one `<svg>` that carries the stroke/fill, so an icon can never
 * override the sidebar's own colours by accident.
 */

export type IconShapeTag =
  | 'path'
  | 'rect'
  | 'circle'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'ellipse';

export interface IconShape {
  tag: IconShapeTag;
  /** The SVG attributes of the shape, e.g. `{ d: 'M2 2 L4 4' }`. */
  attrs: Record<string, string | number>;
}

/** Every icon id the menu can ask for. */
export type SidebarIconId =
  | 'billing'
  | 'quickSale'
  | 'returns'
  | 'udhaar'
  | 'shifts'
  | 'inventory'
  | 'purchases'
  | 'transfers'
  | 'audits'
  | 'fifoStock'
  | 'labelStudio'
  | 'branches'
  | 'quotations'
  | 'promotions'
  | 'commissions'
  | 'dashboard'
  | 'reports'
  | 'customReports'
  | 'expenses'
  | 'invoiceAdmin'
  | 'settings'
  | 'users'
  | 'admin';

/**
 * The one icon set.
 *
 * Every page gets its OWN picture: the quotations bubble is not the invoice
 * sheet, the commission coins are not the users, and the custom-report funnel
 * is not the promotion percent.
 */
export const SIDEBAR_ICON_SHAPES: Record<SidebarIconId, IconShape[]> = {
  // A till / calculator.
  billing: [
    { tag: 'rect', attrs: { x: 4, y: 2, width: 16, height: 20, rx: 2 } },
    { tag: 'line', attrs: { x1: 8, y1: 6, x2: 16, y2: 6 } },
    { tag: 'line', attrs: { x1: 8, y1: 10, x2: 16, y2: 10 } },
    { tag: 'line', attrs: { x1: 8, y1: 14, x2: 12, y2: 14 } },
    { tag: 'line', attrs: { x1: 8, y1: 18, x2: 12, y2: 18 } },
    { tag: 'circle', attrs: { cx: 14.5, cy: 16, r: 1.5 } },
  ],
  // A lightning bolt — the quick sale.
  quickSale: [
    { tag: 'polygon', attrs: { points: '13 2 4 14 11 14 10 22 20 10 13 10' } },
  ],
  // An arrow going back — a return.
  returns: [
    { tag: 'polyline', attrs: { points: '1 4 1 10 7 10' } },
    { tag: 'path', attrs: { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' } },
  ],
  // A card with a chip — credit (udhaar).
  udhaar: [
    { tag: 'rect', attrs: { x: 1, y: 4, width: 22, height: 16, rx: 2 } },
    { tag: 'line', attrs: { x1: 1, y1: 10, x2: 23, y2: 10 } },
    { tag: 'rect', attrs: { x: 4, y: 14, width: 6, height: 4, rx: 1 } },
  ],
  // A clock — the shifts.
  shifts: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 10 } },
    { tag: 'polyline', attrs: { points: '12 6 12 12 16 14' } },
  ],
  // A box — the stock.
  inventory: [
    { tag: 'path', attrs: { d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' } },
  ],
  // A shopping bag — the purchases.
  purchases: [
    { tag: 'path', attrs: { d: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z' } },
    { tag: 'line', attrs: { x1: 3, y1: 6, x2: 21, y2: 6 } },
    { tag: 'path', attrs: { d: 'M16 10a4 4 0 0 1-8 0' } },
  ],
  // Two arrows, one each way — a transfer between places.
  transfers: [
    { tag: 'line', attrs: { x1: 8, y1: 7, x2: 16, y2: 7 } },
    { tag: 'polyline', attrs: { points: '13 4 16 7 13 10' } },
    { tag: 'line', attrs: { x1: 16, y1: 17, x2: 8, y2: 17 } },
    { tag: 'polyline', attrs: { points: '11 14 8 17 11 20' } },
  ],
  // A clipboard with a tick — an audit.
  audits: [
    { tag: 'rect', attrs: { x: 8, y: 2, width: 8, height: 4, rx: 1 } },
    { tag: 'path', attrs: { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' } },
    { tag: 'polyline', attrs: { points: '9 14 11 16 15 12' } },
  ],
  // Stacked layers — FIFO stock.
  fifoStock: [
    { tag: 'path', attrs: { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' } },
    { tag: 'polyline', attrs: { points: '3.27 6.96 12 12.01 20.73 6.96' } },
    { tag: 'line', attrs: { x1: 12, y1: 22.08, x2: 12, y2: 12 } },
  ],
  // A price tag — the label studio.
  labelStudio: [
    { tag: 'path', attrs: { d: 'M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.82 0l3.36-3.36a2 2 0 0 0 0-2.82z' } },
    { tag: 'circle', attrs: { cx: 7.5, cy: 7.5, r: 1 } },
  ],
  // A branch — the branches.
  branches: [
    { tag: 'path', attrs: { d: 'M6 3v12' } },
    { tag: 'circle', attrs: { cx: 18, cy: 6, r: 3 } },
    { tag: 'circle', attrs: { cx: 6, cy: 18, r: 3 } },
    { tag: 'path', attrs: { d: 'M18 9a9 9 0 0 1-9 9' } },
  ],
  // A speech bubble — a quotation.
  quotations: [
    { tag: 'path', attrs: { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' } },
    { tag: 'line', attrs: { x1: 8, y1: 8, x2: 16, y2: 8 } },
    { tag: 'line', attrs: { x1: 8, y1: 12, x2: 13, y2: 12 } },
  ],
  // A percent sign — a promotion.
  promotions: [
    { tag: 'line', attrs: { x1: 19, y1: 5, x2: 5, y2: 19 } },
    { tag: 'circle', attrs: { cx: 6.5, cy: 6.5, r: 2.5 } },
    { tag: 'circle', attrs: { cx: 17.5, cy: 17.5, r: 2.5 } },
  ],
  // A stack of coins — the commissions.
  commissions: [
    { tag: 'path', attrs: { d: 'M12 3c4.42 0 8 1.34 8 3s-3.58 3-8 3-8-1.34-8-3 3.58-3 8-3z' } },
    { tag: 'path', attrs: { d: 'M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6' } },
    { tag: 'path', attrs: { d: 'M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6' } },
  ],
  // Four tiles — the dashboard.
  dashboard: [
    { tag: 'rect', attrs: { x: 3, y: 3, width: 7, height: 9, rx: 1 } },
    { tag: 'rect', attrs: { x: 14, y: 3, width: 7, height: 5, rx: 1 } },
    { tag: 'rect', attrs: { x: 14, y: 12, width: 7, height: 9, rx: 1 } },
    { tag: 'rect', attrs: { x: 3, y: 16, width: 7, height: 5, rx: 1 } },
  ],
  // Bars — the reports.
  reports: [
    { tag: 'line', attrs: { x1: 18, y1: 20, x2: 18, y2: 10 } },
    { tag: 'line', attrs: { x1: 12, y1: 20, x2: 12, y2: 4 } },
    { tag: 'line', attrs: { x1: 6, y1: 20, x2: 6, y2: 14 } },
  ],
  // A funnel — the custom reports.
  customReports: [
    { tag: 'path', attrs: { d: 'M3 4h18l-7 8v6l-4 2v-8z' } },
    { tag: 'line', attrs: { x1: 8, y1: 8, x2: 16, y2: 8 } },
  ],
  // Money going out — the expenses.
  expenses: [
    { tag: 'path', attrs: { d: 'M12 3v11' } },
    { tag: 'polyline', attrs: { points: '8 10 12 14 16 10' } },
    { tag: 'path', attrs: { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' } },
  ],
  // A sheet with a tick — the invoice designer.
  invoiceAdmin: [
    { tag: 'path', attrs: { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' } },
    { tag: 'polyline', attrs: { points: '14 2 14 8 20 8' } },
    { tag: 'line', attrs: { x1: 8, y1: 13, x2: 13, y2: 13 } },
    { tag: 'polyline', attrs: { points: '8 17 10 19 14 15' } },
  ],
  // A cog — the settings.
  settings: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 3 } },
    {
      tag: 'path',
      attrs: {
        d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
      },
    },
  ],
  // People — the users.
  users: [
    { tag: 'path', attrs: { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' } },
    { tag: 'circle', attrs: { cx: 9, cy: 7, r: 4 } },
    { tag: 'path', attrs: { d: 'M23 21v-2a4 4 0 0 0-3-3.87' } },
    { tag: 'path', attrs: { d: 'M16 3.13a4 4 0 0 1 0 7.75' } },
  ],
  // A shield — the admin panel.
  admin: [
    { tag: 'path', attrs: { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' } },
  ],
};

/** Every icon id in the one icon set. */
export const SIDEBAR_ICON_IDS: SidebarIconId[] = Object.keys(
  SIDEBAR_ICON_SHAPES
) as SidebarIconId[];

/** The shapes of an icon — an empty list for an unknown id. */
export function sidebarIconShapes(iconId: string | null | undefined): IconShape[] {
  if (!iconId) return [];
  return SIDEBAR_ICON_SHAPES[iconId as SidebarIconId] ?? [];
}

/**
 * A stable key for an icon's geometry.
 *
 * Two icons are the SAME picture when their keys match — that is how the test
 * proves that no two menu items wear the same icon.
 */
export function iconShapeKey(shapes: IconShape[]): string {
  return shapes
    .map((shape) => {
      const attrs = Object.keys(shape.attrs)
        .sort()
        .map((key) => `${key}=${shape.attrs[key]}`)
        .join(',');
      return `${shape.tag}[${attrs}]`;
    })
    .join('|');
}

/** The key of a named icon — '' for an unknown id. */
export function iconKeyFor(iconId: string | null | undefined): string {
  return iconShapeKey(sidebarIconShapes(iconId));
}
