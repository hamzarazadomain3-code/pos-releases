/**
 * The Pause / F4 bill-edit mode — a PURE reducer.
 *
 * The till screen gets a keyboard-driven way to edit the CURRENT bill: move
 * between the cart rows, change the quantity, switch the unit, edit the price,
 * the discount and the note, and remove a row with an undo.
 *
 * Everything lives here as data (`rows`, `selectedIndex`, `action` → new
 * state) so the component stays thin and every rule is unit-testable without
 * a DOM. The component calls the SAME cart functions the mouse buttons call —
 * this module never duplicates the money maths.
 */

/** One unit of a product (kg, gram, box, piece …). */
export interface BillEditUnit {
  name: string;
  /** How many base units one of this unit holds (kg = 1000 g). */
  quantity_in_base_units: number;
  /** The unit's own selling price, when the shop keeps one. */
  price?: number | null;
}

export interface BillEditRow {
  /** Stable key so an undone row returns to the same position. */
  id: string;
  product_id: number;
  name: string;
  qty: number;
  /** The unit currently in use. */
  unitName: string | null;
  /** Every unit of the product, in order. */
  units: BillEditUnit[];
  /** Index into `units` of the unit in use (-1 = base unit). */
  selectedUnitLevel: number;
  /** The selling price of ONE unit (already the unit price). */
  price: number;
  retail_price: number;
  wholesale_price: number | null;
  cost_price: number;
  line_discount: number;
  tax_rate: number;
  note?: string;
  /** Scale-weighed items refuse a unit switch. */
  isScale?: boolean;
  /** The smallest allowed quantity (never below this). */
  minQty?: number;
  /** The step used by +/- (scale items use their own step). */
  qtyStep?: number;
  /** How many decimals the unit allows. */
  decimals?: number;
  /** Extra rows that share this product but a different unit. */
  productId?: number;
}

export type BillEditMode = 'idle' | 'qty' | 'price' | 'discount' | 'note';

export interface BillEditState {
  rows: BillEditRow[];
  selectedIndex: number;
  /** Which field is being typed into (idle = navigation). */
  mode: BillEditMode;
  qtyText: string;
  priceText: string;
  discountText: string;
  noteText: string;
  /** The last removed row, for the 5-second Undo. */
  undo: { row: BillEditRow; index: number } | null;
  /** A warning raised by the last action (e.g. the unit price is below cost). */
  warning: string | null;
  /** Text for the aria-live region. */
  announcement: string;
  /** True when the mode should hand the keystroke back to the page. */
  exitToSearch: boolean;
  /** The price level in force (Retail / Wholesale / the customer's level). */
  priceMode: 'retail' | 'wholesale';
  /** "Convert quantity when switching unit" (Settings, default OFF). */
  convertOnUnitSwitch: boolean;
}

export type BillEditAction =
  | { type: 'move'; to: 'up' | 'down' | 'home' | 'end' }
  | { type: 'qty-step'; delta: 1 | -1 }
  | { type: 'qty-text'; text: string }
  | { type: 'price-text'; text: string }
  | { type: 'discount-text'; text: string }
  | { type: 'note-text'; text: string }
  | { type: 'commit' }
  | { type: 'cancel' }
  | { type: 'unit' }
  | { type: 'remove' }
  | { type: 'undo' }
  | { type: 'dismiss-warning' };

function round(n: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round((Number(n) || 0) * f) / f;
}

function clampQty(row: BillEditRow, qty: number): number {
  const min = row.minQty ?? 1;
  const decimals = row.decimals ?? 3;
  const value = round(qty, decimals);
  return value < min ? min : value;
}

/** The price one unit of this row sells for, honouring the price level. */
export function unitPriceFor(row: BillEditRow, priceMode: 'retail' | 'wholesale'): number {
  const base =
    priceMode === 'wholesale' && row.wholesale_price != null ? row.wholesale_price : row.retail_price;
  const unit = row.units[row.selectedUnitLevel];
  if (!unit) return base;
  if (unit.price != null && Number.isFinite(Number(unit.price))) return Number(unit.price);
  // No unit price: the base price times how many base units this unit holds.
  return round(base * (unit.quantity_in_base_units || 1), 3);
}

/** The unit's own price for a DIFFERENT unit index (used when switching). */
export function priceForUnit(
  row: BillEditRow,
  unitIndex: number,
  priceMode: 'retail' | 'wholesale'
): number {
  const base =
    priceMode === 'wholesale' && row.wholesale_price != null ? row.wholesale_price : row.retail_price;
  const unit = row.units[unitIndex];
  if (!unit) return base;
  if (unit.price != null && Number.isFinite(Number(unit.price))) return Number(unit.price);
  return round(base * (unit.quantity_in_base_units || 1), 3);
}

export function initialBillEditState(
  rows: BillEditRow[],
  options: { priceMode?: 'retail' | 'wholesale'; convertOnUnitSwitch?: boolean } = {}
): BillEditState {
  return {
    rows,
    selectedIndex: rows.length > 0 ? 0 : -1,
    mode: 'idle',
    qtyText: '',
    priceText: '',
    discountText: '',
    noteText: '',
    undo: null,
    warning: null,
    announcement: rows.length > 0 ? `${rows.length} item(s) in the bill` : 'The bill is empty',
    exitToSearch: false,
    priceMode: options.priceMode ?? 'retail',
    convertOnUnitSwitch: options.convertOnUnitSwitch ?? false,
  };
}

function currentRow(state: BillEditState): BillEditRow | null {
  if (state.selectedIndex < 0 || state.selectedIndex >= state.rows.length) return null;
  return state.rows[state.selectedIndex];
}

function announce(state: BillEditState, text: string): BillEditState {
  return { ...state, announcement: text };
}

/** The hint bar text for the current row. */
export function billEditHint(row: BillEditRow | null): string {
  if (!row) return '';
  return 'Up/Down row · +/- qty · Enter type qty · U unit · P price · D disc · N note · Del remove · Esc back';
}

/**
 * The reducer. Pure: it never mutates its input.
 */
export function billEditReducer(state: BillEditState, action: BillEditAction): BillEditState {
  switch (action.type) {
    case 'move': {
      if (state.rows.length === 0) return { ...state, selectedIndex: -1 };
      let next = state.selectedIndex;
      if (action.to === 'up') next = Math.max(0, state.selectedIndex - 1);
      else if (action.to === 'down') next = Math.min(state.rows.length - 1, state.selectedIndex + 1);
      else if (action.to === 'home') next = 0;
      else if (action.to === 'end') next = state.rows.length - 1;
      next = Math.max(0, Math.min(state.rows.length - 1, next));
      const row = state.rows[next];
      return announce({ ...state, selectedIndex: next, mode: 'idle', warning: null },
        row ? `${row.name}, quantity ${row.qty}` : '');
    }

    case 'qty-step': {
      const row = currentRow(state);
      if (!row) return state;
      const step = row.qtyStep ?? 1;
      const qty = clampQty(row, row.qty + action.delta * step);
      const rows = state.rows.map((r, i) => (i === state.selectedIndex ? { ...r, qty } : r));
      return announce({ ...state, rows, warning: null }, `${row.name} quantity ${qty}`);
    }

    case 'qty-text':
      return { ...state, qtyText: action.text, mode: 'qty' };

    case 'price-text':
      return { ...state, priceText: action.text, mode: 'price' };

    case 'discount-text':
      return { ...state, discountText: action.text, mode: 'discount' };

    case 'note-text':
      return { ...state, noteText: action.text, mode: 'note' };

    case 'commit': {
      const row = currentRow(state);
      if (!row) return state;
      if (state.mode === 'qty') {
        const parsed = Number(state.qtyText);
        if (!Number.isFinite(parsed)) {
          return { ...state, mode: 'idle', qtyText: '', warning: 'Quantity is not a number' };
        }
        const qty = clampQty(row, parsed);
        const rows = state.rows.map((r, i) => (i === state.selectedIndex ? { ...r, qty } : r));
        return announce({ ...state, rows, mode: 'idle', qtyText: '' }, `${row.name} quantity ${qty}`);
      }
      if (state.mode === 'price') {
        const parsed = Number(state.priceText);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return { ...state, mode: 'idle', priceText: '', warning: 'Price is not a valid number' };
        }
        const price = round(parsed, 3);
        const belowCost = price < row.cost_price;
        const rows = state.rows.map((r, i) => (i === state.selectedIndex ? { ...r, price } : r));
        return announce(
          {
            ...state,
            rows,
            mode: 'idle',
            priceText: '',
            warning: belowCost ? `${row.name} is below its cost price` : null,
          },
          `${row.name} price ${price}`
        );
      }
      if (state.mode === 'discount') {
        const parsed = Number(state.discountText);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return { ...state, mode: 'idle', discountText: '', warning: 'Discount is not a valid number' };
        }
        const line_discount = round(parsed, 3);
        const rows = state.rows.map((r, i) => (i === state.selectedIndex ? { ...r, line_discount } : r));
        return announce({ ...state, rows, mode: 'idle', discountText: '' }, `${row.name} discount ${line_discount}`);
      }
      if (state.mode === 'note') {
        const note = state.noteText;
        const rows = state.rows.map((r, i) => (i === state.selectedIndex ? { ...r, note } : r));
        return announce({ ...state, rows, mode: 'idle', noteText: '' }, `${row.name} note updated`);
      }
      return { ...state, mode: 'idle' };
    }

    case 'cancel':
      return {
        ...state,
        mode: 'idle',
        qtyText: '',
        priceText: '',
        discountText: '',
        noteText: '',
      };

    case 'unit': {
      const row = currentRow(state);
      if (!row) return state;
      if (row.isScale) {
        return { ...state, warning: 'Scale items cannot switch units' };
      }
      if (!row.units || row.units.length <= 1) {
        return { ...state, warning: 'Only one unit' };
      }
      const nextLevel = (row.selectedUnitLevel + 1) % row.units.length;
      const nextUnit = row.units[nextLevel];
      const price = priceForUnit(row, nextLevel, state.priceMode);
      const belowCost = price < row.cost_price;
      let qty = row.qty;
      let warning: string | null = belowCost ? `${nextUnit.name} price is below the cost price` : null;

      if (state.convertOnUnitSwitch) {
        const fromFactor = row.units[row.selectedUnitLevel]?.quantity_in_base_units || 1;
        const toFactor = nextUnit.quantity_in_base_units || 1;
        const converted = (row.qty * fromFactor) / toFactor;
        const decimals = row.decimals ?? 3;
        qty = round(converted, decimals);
        if (!Number.isFinite(converted) || converted <= 0) {
          warning = 'This unit cannot be converted';
        }
      }

      const rows = state.rows.map((r, i) =>
        i === state.selectedIndex
          ? { ...r, selectedUnitLevel: nextLevel, unitName: nextUnit.name, price, qty }
          : r
      );
      return announce(
        { ...state, rows, warning, mode: 'idle' },
        `${row.name} unit ${nextUnit.name}, price ${price}, quantity ${qty}`
      );
    }

    case 'remove': {
      const row = currentRow(state);
      if (!row) return state;
      const rows = state.rows.filter((_, i) => i !== state.selectedIndex);
      const index = state.selectedIndex;
      const nextIndex = Math.min(index, rows.length - 1);
      return announce(
        {
          ...state,
          rows,
          undo: { row, index },
          selectedIndex: rows.length === 0 ? -1 : Math.max(0, nextIndex),
          mode: 'idle',
          warning: null,
        },
        `Removed ${row.name}`
      );
    }

    case 'undo': {
      if (!state.undo) return state;
      const { row, index } = state.undo;
      const rows = state.rows.slice();
      const at = Math.max(0, Math.min(rows.length, index));
      rows.splice(at, 0, row);
      return announce(
        { ...state, rows, undo: null, selectedIndex: at, mode: 'idle' },
        `Restored ${row.name}`
      );
    }

    case 'dismiss-warning':
      return { ...state, warning: null };

    default:
      return state;
  }
}

/**
 * The keyboard map of the mode. A key that is NOT in this list leaves the
 * mode and goes to the product search box.
 */
export type BillEditKeyAction =
  | 'move-up'
  | 'move-down'
  | 'move-home'
  | 'move-end'
  | 'qty-up'
  | 'qty-down'
  | 'qty-edit'
  | 'price-edit'
  | 'discount-edit'
  | 'note-edit'
  | 'unit'
  | 'remove'
  | 'undo'
  | 'exit';

export interface BillEditKeyEvent {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Map a key press to a mode action.
 *
 * - `+`, `=` and ArrowRight add one; `-` and ArrowLeft subtract one.
 * - Enter or a digit focuses the quantity field.
 * - U cycles the unit, P the price, D the discount, N the note.
 * - Delete / Backspace removes the row, Ctrl+Z undoes it.
 * - Anything else leaves the mode (`exit`).
 */
export function billEditKeyAction(e: BillEditKeyEvent): BillEditKeyAction {
  const key = e.key;
  if (e.ctrlKey && (key === 'z' || key === 'Z')) return 'undo';
  switch (key) {
    case 'ArrowUp':
      return 'move-up';
    case 'ArrowDown':
      return 'move-down';
    case 'Home':
      return 'move-home';
    case 'End':
      return 'move-end';
    case '+':
    case '=':
    case 'ArrowRight':
      return 'qty-up';
    case '-':
    case '_':
    case 'ArrowLeft':
      return 'qty-down';
    case 'Enter':
    case 'Backspace':
      return 'remove';
    case 'Delete':
      return 'remove';
    case 'u':
    case 'U':
      return 'unit';
    case 'p':
    case 'P':
      return 'price-edit';
    case 'd':
    case 'D':
      return 'discount-edit';
    case 'n':
    case 'N':
      return 'note-edit';
    default:
      if (/^[0-9]$/.test(key)) return 'qty-edit';
      return 'exit';
  }
}

/**
 * Is this keystroke burst a BARCODE SCAN? A burst of fast key presses that
 * ends with Enter is a scanner, and the mode must never swallow it.
 */
export function isScannerBurst(timestamps: number[], scanTimeoutMs = 50): boolean {
  if (!Array.isArray(timestamps) || timestamps.length < 2) return false;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let fast = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > scanTimeoutMs) {
      fast = false;
      break;
    }
  }
  return fast;
}

/** The keyboard hint bar for the mode. */
export const BILL_EDIT_HINT =
  'Up/Down row · +/- qty · Enter type qty · U unit · P price · D disc · N note · Del remove · Esc back';
