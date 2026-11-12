import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CashDrawer from '../components/CashDrawer';
import LiveClock from '../components/LiveClock';
import { Modal } from '../components/Modal';
import CustomerCombobox from '../components/CustomerCombobox';
import QuickCustomerDialog from '../components/QuickCustomerDialog';
import { UdhaarCustomerModal } from '../components/UdhaarCustomerModal';
import { DateInput } from '../components/DateInput';
import { KeyboardInput } from '../components/KeyboardInput';
import { runEscapeGesture, runPageRefresh } from '../keyboard/escapeRefresh';
import { formatDateTimeAdmin, formatTimeAdmin, formatDateAdmin, toLocalDateString } from '../utils/dateUtils';
import { getCurrencySymbol, formatMoney } from '../utils/currency';
import { eventCombo, keyFromEvent, matchesShortcut } from '../utils/shortcutKeys';
import { type CartLine, lineTotals, rehydrateCartLines, serializeCartLine, summarizeHeldBill, type HeldBillSummary } from '@shared/cartMath';
import { defaultCombo, hintRows, isActionAllowedOn, resolveCombo, resolveCombos } from '@shared/shortcuts';
import { parseNegativeStockPolicy, checkNegativeStock, type NegativeStockPolicy } from '@shared/negativeStock';
import { applyCustomerDiscount, customerDiscountBadge, describeDiscountSource, minBillHint } from '@shared/customerDiscount';
import {
  billEditReducer,
  billEditKeyAction,
  initialBillEditState,
  BILL_EDIT_HINT,
  type BillEditRow,
  type BillEditState,
} from '@shared/billEdit';
import {
  HISTORY_EVENT_CLASSES,
  HISTORY_EVENT_LABELS,
  HISTORY_EVENT_TYPES,
  type HistoryDetail,
  type HistoryEventRow,
  type HistoryEventType,
  type HistoryFilters,
  type HistorySummary,
  type HistoryTypeCount,
} from '@shared/salesHistory';
import type {
  Category,
  Customer,
  CustomerInput,
  HeldBill,
  NavPage,
  Product,
  ResolvedPromotion,
  Sale,
  SaleDetail,
  SaleCreateResult,
  SaleItem,
  ShiftDetail,
  ShiftRow,
  UserRow,
} from '../../../shared/types';

function isExpired(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00').getTime() < today.getTime();
}

function formatStockQty(qty: number): string {
  return Number(qty.toFixed(2)).toString();
}

const LOW_STOCK_THRESHOLD = 10;

// ── Billing-local shortcuts ──────────────────────────────────────────────────
// The combos are NOT hard-coded here: they come from the shared registry so the
// footer hint bar, the F1 overlay and the handler can never disagree. Lowercased
// because `eventCombo()` compares against a lowercase combo string.
const BILLING_KEYS = {
  search: defaultCombo('billing_search').toLowerCase(),
  newBill: defaultCombo('billing_new').toLowerCase(),
  repeat: defaultCombo('billing_repeat').toLowerCase(),
  express: defaultCombo('billing_express').toLowerCase(),
  hold: defaultCombo('billing_hold').toLowerCase(),
  held: defaultCombo('billing_held').toLowerCase(),
} as const;

// Registry-driven hint rows: the footer strip and the F1 overlay are generated
// from the same list, so adding/renaming a billing shortcut updates both.
const BILLING_HINTS = hintRows('billing');

interface PayRow {
  mode: string;
  amount: string;
}

const MODES = ['Cash', 'Card', 'Easypaisa', 'JazzCash'];

// Return / Refund — the refund methods and the canned reasons the till offers.
const RETURN_REASONS = [
  'Customer changed mind',
  'Damaged / faulty',
  'Wrong item',
  'Expired',
  'Other',
];
/** Renderer-side form state; converted to the shared HistoryFilters for IPC. */
interface HistoryUiFilters {
  from: string;
  to: string;
  types: HistoryEventType[];
  search: string;
  customer: string;
  userId: string;
  paymentMode: string;
  product: string;
  minAmount: string;
  maxAmount: string;
  onlyMySales: boolean;
}

function emptyHistoryUiFilters(): HistoryUiFilters {
  return {
    from: '',
    to: '',
    types: [...HISTORY_EVENT_TYPES],
    search: '',
    customer: '',
    userId: '',
    paymentMode: '',
    product: '',
    minAmount: '',
    maxAmount: '',
    onlyMySales: false,
  };
}

function historyUiFromService(f: HistoryFilters): HistoryUiFilters {
  return {
    from: f.from ?? '',
    to: f.to ?? '',
    types: f.types && f.types.length ? f.types : [...HISTORY_EVENT_TYPES],
    search: f.search ?? '',
    customer: f.customer ?? '',
    userId: f.userId != null ? String(f.userId) : '',
    paymentMode: f.paymentMode ?? '',
    product: f.product ?? '',
    minAmount: f.minAmount != null ? String(f.minAmount) : '',
    maxAmount: f.maxAmount != null ? String(f.maxAmount) : '',
    onlyMySales: !!f.onlyMySales,
  };
}

function historyUiToService(f: HistoryUiFilters): HistoryFilters {
  return {
    from: f.from || undefined,
    to: f.to || undefined,
    types: f.types,
    search: f.search || undefined,
    customer: f.customer || undefined,
    userId: f.userId ? Number(f.userId) : null,
    paymentMode: f.paymentMode || undefined,
    product: f.product || undefined,
    minAmount: f.minAmount ? Number(f.minAmount) : null,
    maxAmount: f.maxAmount ? Number(f.maxAmount) : null,
    onlyMySales: f.onlyMySales,
  };
}

const RETURN_REFUND_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'easypaisa', label: 'Easypaisa' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'credit', label: 'Adjust to customer credit' },
];

interface BillingProps {
  onNavigate?: (page: NavPage) => void;
  onLogout?: () => void;
}

export default function Billing({ onNavigate, onLogout }: BillingProps) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [browseCategory, setBrowseCategory] = useState<number | 'all'>('all');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  /** The quick "New customer" dialog (opened from the combobox or F6). */
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickCustomerSeed, setQuickCustomerSeed] = useState('');
  /** The full customer form, opened from the quick dialog's "Open full form". */
  const [fullCustomerOpen, setFullCustomerOpen] = useState(false);
  const [fullCustomerSeed, setFullCustomerSeed] = useState<Partial<CustomerInput>>({});
  /** Bumped to open the customer combobox from anywhere (F6). */
  const [customerSearchSignal, setCustomerSearchSignal] = useState(0);
  /** The Pause / F4 bill-edit mode is on. */
  const [billEditMode, setBillEditMode] = useState(false);
  /** Settings > Keyboard: the Esc gesture (default ON). */
  const [escapeGestureEnabled, setEscapeGestureEnabled] = useState(true);
  /** Settings > Keyboard: the double-Esc window in ms. */
  const [escapeDoubleTapWindowMs, setEscapeDoubleTapWindowMs] = useState(400);
  const [quotationMode, setQuotationMode] = useState(false);
  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [billDiscount, setBillDiscount] = useState('');
  const [autoAppliedDiscount, setAutoAppliedDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  /** Where the current bill discount came from (saved on the sale). */
  const [discountSource, setDiscountSource] = useState<
    'customer_percent' | 'customer_fixed' | 'manual' | 'promotion' | 'none'
  >('none');
  /** The cashier removed the customer discount for THIS bill — never re-add it. */
  const [discountRemoved, setDiscountRemoved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payRows, setPayRows] = useState<PayRow[]>([]);
  const [custModal, setCustModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustBalance, setNewCustBalance] = useState('');
  const [success, setSuccess] = useState<SaleCreateResult | null>(null);
  const [heldModal, setHeldModal] = useState<{ tab: 'held' | 'quotation'; rows: HeldBill[] } | null>(null);
  // Return / Refund — done in place on the till screen. The cart itself is the
  // return: confirm it and the items are written back as a negative sale (see
  // `returns.createReturnBill`). An empty cart offers to pull a past invoice in.
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);
  const [returnFindOpen, setReturnFindOpen] = useState(false);
  const [returnFind, setReturnFind] = useState('');
  const [returnFindBusy, setReturnFindBusy] = useState(false);
  const [returnFindResults, setReturnFindResults] = useState<Sale[]>([]);
  const [returnLinkedSaleId, setReturnLinkedSaleId] = useState<number | null>(null);
  const [returnLinkedInvoice, setReturnLinkedInvoice] = useState('');
  const [returnRefundMode, setReturnRefundMode] = useState<string>('cash');
  const [returnReason, setReturnReason] = useState('Customer changed mind');
  const [returnNote, setReturnNote] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const returnConfirmBtnRef = useRef<HTMLButtonElement>(null);
  /** `null` = modal closed. An empty array = open with "No activity today yet". */
  const [history, setHistory] = useState<HistoryEventRow[] | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historySummary, setHistorySummary] = useState<HistorySummary | null>(null);
  const [historyCounts, setHistoryCounts] = useState<HistoryTypeCount[]>([]);
  const [historyOpenHolds, setHistoryOpenHolds] = useState(0);
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null);
  const [holdDeleteTarget, setHoldDeleteTarget] = useState<HeldBill | null>(null);
  const [holdDeleteReason, setHoldDeleteReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [ctrlSPressTime, setCtrlSPressTime] = useState<number>(0);
  const [promoMap, setPromoMap] = useState<Record<number, ResolvedPromotion>>({});
  const [historyFilters, setHistoryFilters] = useState<HistoryUiFilters>(emptyHistoryUiFilters());
  const [datePreset, setDatePreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'lastmonth' | 'custom'>('today');
  const [cashiers, setCashiers] = useState<UserRow[]>([]);
  const [saleDetail, setSaleDetail] = useState<SaleDetail | null>(null);
  const [paymentModes] = useState(['Cash', 'Card', 'Udhaar', 'Wholesale']);
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [openCash, setOpenCash] = useState('0');
  const [closeShiftModal, setCloseShiftModal] = useState<ShiftDetail | null>(null);
  const [countedCash, setCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [expiredConfirm, setExpiredConfirm] = useState<CartLine[] | null>(null);
  const [belowCostConfirm, setBelowCostConfirm] = useState<CartLine[] | null>(null);
  const [priceFloorOverride, setPriceFloorOverride] = useState(false);
  const [priceFloorPin, setPriceFloorPin] = useState('');
  const [managerUsers, setManagerUsers] = useState<UserRow[]>([]);
  const [priceFloorEnabled, setPriceFloorEnabled] = useState(true);
  // Phase 1: 'yes' | 'warn' | 'no' — whether selling more than available stock is allowed.
  // 'warn' shows an amber badge + one toast per bill but still saves; 'no' blocks the old way.
  const [allowNegativeStock, setAllowNegativeStock] = useState<NegativeStockPolicy>('warn');
  const [maxNegativeQty, setMaxNegativeQty] = useState(0);
  const negStockWarnedRef = useRef(false);
  // Phase 1: single non-blocking toast per bill when selling beyond available stock in 'warn' mode.
  const warnNegativeStockOnce = useCallback(() => {
    if (allowNegativeStock !== 'warn' || negStockWarnedRef.current) return;
    const over = items.filter((i) => {
      if (i.stock_qty == null) return false;
      const result = checkNegativeStock(i, i.qty, allowNegativeStock, maxNegativeQty);
      return !result.allowed || result.warning !== null;
    });
    if (over.length === 0) return;
    negStockWarnedRef.current = true;
    const first = over[0];
    const result = checkNegativeStock(first, first.qty, allowNegativeStock, maxNegativeQty);
    if (result.warning) {
      setNotice(`⚠ ${result.warning}. Sale will still be saved.`);
    }
  }, [allowNegativeStock, items, maxNegativeQty]);
  const [priceFloorUserId, setPriceFloorUserId] = useState<number | null>(null);
  const [priceEditEnabled, setPriceEditEnabled] = useState(true);
  const [priceEditUnlockOpen, setPriceEditUnlockOpen] = useState(false);
  const [priceEditUserId, setPriceEditUserId] = useState<number | null>(null);
  const [priceEditPin, setPriceEditPin] = useState('');
  const [serviceCharge, setServiceCharge] = useState('');
  const [serviceChargeType, setServiceChargeType] = useState<'amount' | 'percent'>('amount');
  const [freight, setFreight] = useState('');
  const [billRemarks, setBillRemarks] = useState('');
  const [quickAmount, setQuickAmount] = useState('');
  const [payModeQuick, setPayModeQuick] = useState('Cash');
  const [scannerLastSeen, setScannerLastSeen] = useState<number | null>(null);
  const [scannerConnected, setScannerConnected] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [cashDrawerOpen, setCashDrawerOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [quotationCount, setQuotationCount] = useState(0);
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [shortcutMap, setShortcutMap] = useState<Record<string, string>>({});
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [flashingItemId, setFlashingItemId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  // Browse-grid keyboard navigation + quick quantity entry
  const [browseIndex, setBrowseIndex] = useState(-1);
  const [pendingQty, setPendingQty] = useState(1);
  const [qtyDialog, setQtyDialog] = useState<{ product: Product } | null>(null);
  const [qtyDialogValue, setQtyDialogValue] = useState('1');
  const pendingQtyRef = useRef(1);
  pendingQtyRef.current = pendingQty;
  const browseListRef = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<number | null>(null);
  const bufferGapRef = useRef(150);
  const printInvoiceBtnRef = useRef<HTMLButtonElement>(null);

  // ── Keyboard zone navigation (search → browse → cart → summary → buttons) ──
  const [kbZone, setKbZone] = useState<'none' | 'search' | 'browse' | 'cart' | 'summary' | 'buttons'>('none');
  const [cartSelIdx, setCartSelIdx] = useState(-1);
  const [summarySelIdx, setSummarySelIdx] = useState(-1);
  const [btnSelIdx, setBtnSelIdx] = useState(-1);
  const cartListRef = useRef<HTMLDivElement>(null);
  const cartRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const summaryFieldsRef = useRef<Array<HTMLInputElement | HTMLSelectElement | null>>([]);
  const actionBtnsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const actionPanelRef = useRef<HTMLDivElement>(null);

  const focusBrowseItem = useCallback((idx: number) => {
    const els = browseListRef.current?.querySelectorAll<HTMLButtonElement>('.browse-item');
    if (!els || idx < 0 || idx >= els.length) return;
    els[idx].focus();
    els[idx].scrollIntoView({ block: 'nearest' });
  }, []);

  const focusCartRow = useCallback((idx: number) => {
    const el = cartRowRefs.current[idx];
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: 'nearest' });
  }, []);

  const focusSummaryField = useCallback((idx: number) => {
    const el = summaryFieldsRef.current[idx];
    if (!el) return;
    el.focus();
    el.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const focusActionBtn = useCallback((idx: number) => {
    const el = actionBtnsRef.current[idx];
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: 'nearest' });
  }, []);

  const adjustLineQty = useCallback((idx: number, newQty: number) => {
    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: Math.max(1, newQty) } : x)));
  }, []);

  const removeCartLine = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Receipt sending
  const [emailToSend, setEmailToSend] = useState('');
  const [smsToSend, setSmsToSend] = useState('');

  // Enhancement: Favorites/pinned products
  const [favorites, setFavorites] = useState<number[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);

  // Enhancement: Round-off settings
  const [roundOffEnabled, setRoundOffEnabled] = useState(false);
  const [roundOffValue, setRoundOffValue] = useState<'0.50' | '1.00'>('1.00');

  // Enhancement: F1 shortcut modal
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);

  // Enhancement: Split bill
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitItems, setSplitItems] = useState<Record<number, number>>({});

  // Enhancement: Customer loyalty
  const [selectedCustomerLoyalty, setSelectedCustomerLoyalty] = useState<{ points: number; tier: string } | null>(null);

  // Enhancement: Express checkout
  const [expressBusy, setExpressBusy] = useState(false);

  // Enhancement: Repeat last sale
  const [lastSaleItems, setLastSaleItems] = useState<CartLine[] | null>(null);
  const [lastSaleCustomer, setLastSaleCustomer] = useState<string>('');

  // Enhancement: Return mode
  const [returnMode, setReturnMode] = useState(false);

  // Enhancement: Profit live (owner only)
  const [profitLive, setProfitLive] = useState<{ cost: number; revenue: number; margin: number } | null>(null);

  // Enhancement: Running total bar visibility
  const [showRunningBar, setShowRunningBar] = useState(true);

  // Receipt template selector
  const [receiptTemplates, setReceiptTemplates] = useState<Array<{ id: string; name: string; description: string; width: string }>>([]);
  const [receiptTemplate, setReceiptTemplate] = useState<string>('standard');

  const searchRef = useRef<HTMLInputElement>(null);
  const totals = useMemo(() => lineTotals(items, Number(billDiscount) || 0, discountType, promoMap), [items, billDiscount, discountType, promoMap]);
  // Reuses the same active+category filter logic as the (removed) quick-sale grid:
  // a category click populates this grid immediately with matching active products.
  const browseProducts = useMemo(
    () =>
      allProducts.filter(
        (p) =>
          (browseCategory === 'all' || Number(p.category_id) === Number(browseCategory)) &&
          Number(p.active) === 1
      ),
    [allProducts, browseCategory]
  );
  const serviceChargeAmt = serviceChargeType === 'percent'
    ? (totals.total * (Number(serviceCharge) || 0)) / 100
    : Number(serviceCharge) || 0;
  const freightAmt = Number(freight) || 0;
  const grandTotal = totals.total + serviceChargeAmt + freightAmt;

  // Enhancement: Round-off calculation
  const roundOffAmount = useMemo(() => {
    if (!roundOffEnabled) return 0;
    const roundTo = roundOffValue === '0.50' ? 0.5 : 1;
    const rounded = Math.round(grandTotal / roundTo) * roundTo;
    return Math.round((rounded - grandTotal) * 100) / 100;
  }, [grandTotal, roundOffEnabled, roundOffValue]);

  const finalTotal = grandTotal + roundOffAmount;

  // ── Return / Refund flow ───────────────────────────────────────────────────
  // What the customer gets back: qty × the cart's entered unit price per line.
  const returnTotal = useMemo(
    () => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0),
    [items]
  );

  const resetReturnState = useCallback(() => {
    setReturnConfirmOpen(false);
    setReturnFindOpen(false);
    setReturnFind('');
    setReturnFindResults([]);
    setReturnLinkedSaleId(null);
    setReturnLinkedInvoice('');
    setReturnNote('');
    setReturnRefundMode('cash');
    setReturnReason('Customer changed mind');
  }, []);

  /**
   * The Return / Refund button + its shortcut. An empty cart cannot become a
   * return, so it opens the "find a past invoice" helper instead (and shows the
   * hint toast); a cart with lines goes straight to the confirmation popup.
   */
  const openReturnFlow = useCallback(() => {
    if (items.length === 0) {
      setReturnFind('');
      setReturnFindResults([]);
      setReturnFindBusy(true);
      setReturnLinkedSaleId(null);
      setReturnLinkedInvoice('');
      setReturnFindOpen(true);
      setNotice('Add products to return, or press F-key to search a past invoice');
      window.api.sales
        .list()
        .then((rows) => setReturnFindResults(rows.slice(0, 50)))
        .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
        .finally(() => setReturnFindBusy(false));
    } else {
      setReturnRefundMode('cash');
      setReturnReason('Customer changed mind');
      setReturnNote('');
      setReturnConfirmOpen(true);
    }
  }, [items.length]);

  const returnFindMatches = useMemo(() => {
    const q = returnFind.trim().toLowerCase();
    if (!q) return returnFindResults;
    return returnFindResults.filter(
      (s) =>
        (s.invoice_no ?? '').toLowerCase().includes(q) ||
        (s.customer_name ?? '').toLowerCase().includes(q)
    );
  }, [returnFindResults, returnFind]);

  /** Pull an invoice's lines into the cart so they can be returned from here. */
  const loadReturnInvoice = useCallback(
    (saleId: number) => {
      setReturnFindBusy(true);
      window.api.sales
        .get(saleId)
        .then((detail) => {
          if (!detail) throw new Error('Sale not found');
          const lines: CartLine[] = detail.items.map((it) => {
            const p = allProducts.find((x) => x.id === it.product_id);
            return {
              product_id: it.product_id,
              name: it.product_name || p?.name || `#${it.product_id}`,
              qty: it.qty,
              price: it.unit_price,
              retail_price: p?.sale_price ?? it.unit_price,
              wholesale_price: p?.wholesale_price ?? null,
              cost_price: p?.cost_price ?? 0,
              line_discount: 0,
              tax_rate: it.tax_rate ?? 0,
              expired: false,
              shelf_location: p?.shelf_location ?? null,
              stock_qty: p?.stock_qty ?? 0,
              units: [],
              selected_unit_level: 0,
            } as CartLine;
          });
          setItems(lines);
          if (detail.customer_id) setCustomerId(String(detail.customer_id));
          setReturnLinkedSaleId(detail.id);
          setReturnLinkedInvoice(detail.invoice_no);
          setReturnFindOpen(false);
          setReturnRefundMode('cash');
          setReturnReason('Customer changed mind');
          setReturnNote('');
          setNotice(`Loaded ${lines.length} line(s) from ${detail.invoice_no} — review and confirm`);
          setReturnConfirmOpen(true);
        })
        .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
        .finally(() => setReturnFindBusy(false));
    },
    [allProducts]
  );

  /** Write the cart out as a return, then clear the bill. */
  const confirmReturn = useCallback(async () => {
    if (!items.length || returnBusy) return;
    setReturnBusy(true);
    try {
      const res = await window.api.returns.createBill({
        items: items.map((i) => ({
          product_id: i.product_id,
          qty: Number(i.qty) || 0,
          unit_price: Number(i.price) || 0,
        })),
        customer_id: customerId ? Number(customerId) : null,
        reason: returnReason,
        note: returnNote,
        refund_mode: returnRefundMode,
        restock: true,
        linked_sale_id: returnLinkedSaleId,
      });
      const refunded = Number(res.refund_amount) || 0;
      const modeLabel =
        returnRefundMode === 'credit'
          ? 'customer credit'
          : returnRefundMode.charAt(0).toUpperCase() + returnRefundMode.slice(1);
      resetReturnState();
      // Mirror the sale path: the bill is finished, so start a clean one.
      setItems([]);
      setBillDiscount('');
      setPriceFloorOverride(false);
      setNotice(`Return saved — ${formatMoney(refunded)} refunded via ${modeLabel}`);
      if (res.sale_id) {
        window.api.printing
          .printSale(res.sale_id, receiptTemplate)
          .then((r) => {
            if (r && r.ok === false) setNotice(`Return saved, but printing failed: ${r.message}`);
          })
          .catch((e) =>
            setNotice(`Return saved, but printing failed: ${e instanceof Error ? e.message : String(e)}`)
          );
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setReturnBusy(false);
    }
  }, [
    items,
    returnBusy,
    customerId,
    returnReason,
    returnNote,
    returnRefundMode,
    returnLinkedSaleId,
    receiptTemplate,
    resetReturnState,
  ]);

  // Category filter derived values
const handleOpenCashDrawer = async () => {
    setCashDrawerOpen(true);
  };

  useEffect(() => {
    if (!scannerLastSeen) {
      setScannerConnected(false);
      return;
    }
    setScannerConnected(true);
    const t = window.setTimeout(() => setScannerConnected(false), 30000);
    return () => window.clearTimeout(t);
  }, [scannerLastSeen]);

  useEffect(() => {
    if (!items.length) {
      setPromoMap({});
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await window.api.promotions.resolve(
          items.map((i) => ({ product_id: i.product_id, qty: i.qty, price: i.price }))
        );
        const map: Record<number, ResolvedPromotion> = {};
        for (const r of res) if (r.promo_id !== null) map[r.product_id] = r;
        setPromoMap(map);
      } catch {
        /* promotions are best-effort at display; backend is authoritative */
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [items]);

  const addProduct = useCallback(
     (p: Product, scaleOpts?: { scale_plu: string; scale_price: number }, qty = 1) => {
      const expired = isExpired(p.expiry_date);
      const addQty = Math.max(1, Math.floor(qty) || 1);
      setItems((prev) => {
        const units = (p as any).units ?? [];

        // --- BayLan Label Scale item: decoded price from label, qty=1 ---
        if (scaleOpts) {
          // Calculate weight from decoded total price and product's per-unit (per-kg) price
          const pricePerKg = p.sale_price || 1;
          const weightKg = pricePerKg > 0 ? scaleOpts.scale_price / pricePerKg : 0;
          const weightG = Math.round(weightKg * 1000);
          return [
            ...prev,
            {
              product_id: p.id,
              name: p.name,
              qty: 1,
              price: scaleOpts.scale_price,   // decoded total price from scale label
              retail_price: p.sale_price,
              wholesale_price: p.wholesale_price,
              cost_price: p.cost_price,
              line_discount: 0,
              tax_rate: p.tax_rate,
              expired,
              shelf_location: p.shelf_location,
              stock_qty: p.stock_qty,
              units,
              selected_unit_level: 0,
              scale_plu: scaleOpts.scale_plu,
              scale_price: scaleOpts.scale_price,
              scale_weight_g: weightG,
              scale_weight_kg: weightKg,
            },
          ];
        }

        // --- Normal item ---
        const found = prev.find((i) => i.product_id === p.id && !i.scale_price);
        if (found) {
          return prev.map((i) =>
            i.product_id === p.id && !i.scale_weight_kg
              ? { ...i, qty: i.qty + addQty, expired: expired || i.expired }
              : i
          );
        }
        const price = (p as any).sale_price;
        return [
          ...prev,
          {
            product_id: p.id,
            name: p.name,
            qty: addQty,
            price,
            retail_price: p.sale_price,
            wholesale_price: p.wholesale_price,
            cost_price: p.cost_price,
            line_discount: 0,
            tax_rate: p.tax_rate,
            expired,
            shelf_location: p.shelf_location,
            stock_qty: p.stock_qty,
            units,
            selected_unit_level: (p as any).selected_unit_level ?? 0,
          },
        ];
      });
    },
    []
  );

  const openQtyDialog = useCallback((p: Product) => {
    setQtyDialogValue(String(pendingQtyRef.current));
    setQtyDialog({ product: p });
  }, []);

  const confirmQtyDialog = useCallback(() => {
    if (!qtyDialog) return;
    const n = parseInt(qtyDialogValue, 10);
    const q = Number.isFinite(n) && n > 0 ? n : 1;
    addProduct(qtyDialog.product, undefined, q);
    setQtyDialog(null);
  }, [qtyDialog, qtyDialogValue, addProduct]);

  useEffect(() => {
    if (browseProducts.length === 0) {
      setBrowseIndex(-1);
    } else if (browseIndex > browseProducts.length - 1) {
      setBrowseIndex(browseProducts.length - 1);
    }
  }, [browseProducts, browseIndex]);

  const switchPriceMode = useCallback((mode: 'retail' | 'wholesale') => {
    setPriceMode(mode);
    setItems((prev) =>
      prev.map((i) =>
        i.scale_price != null
          ? i // scale items: decoded total price must not be overwritten by mode switch
          : {
              ...i,
              price: mode === 'wholesale' && i.wholesale_price != null ? i.wholesale_price : i.retail_price,
            }
      )
    );
  }, []);

  // -------------------------------------------------------------------
  // BayLan RLS1100 Label Scale — barcode parser (v1.7.1)
  // Format: 21 | PPPPP | PPPPP | C  (13 digits, EAN-13 check digit)
  //   21      = prefix (identifies scale-generated price barcode)
  //   PPPPP   = PLU/item code (5 digits)
  //   PPPPP   = total price in whole currency units (5 digits, zero-padded)
  //   C       = EAN-13 check digit
  // Example: 2110001002342 → PLU="10001", Price=234
  // -------------------------------------------------------------------
  function isValidEan13(barcode: string): boolean {
    if (!/^\d{13}$/.test(barcode)) return false;
    const sum = barcode
      .slice(0, 12)
      .split('')
      .reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
    const check = (10 - (sum % 10)) % 10;
    return check === Number(barcode[12]);
  }

  function parseBayLanBarcode(barcode: string): { plu: string; price: number } | null {
    if (barcode.length !== 13) return null;
    if (barcode.substring(0, 2) !== '21') return null;
    if (!isValidEan13(barcode)) return null;
    const plu = barcode.substring(2, 7);        // 5-digit PLU
    const priceStr = barcode.substring(7, 12);  // 5-digit encoded price
    const price = parseInt(priceStr, 10);
    if (isNaN(price) || price <= 0) return null;
    return { plu, price };
  }

  const scanAdd = useCallback(
    async (barcode: string) => {
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 300;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // --- Try BayLan Label Scale barcode first ---
          const scaleData = parseBayLanBarcode(barcode);
          if (scaleData) {
            console.log(`[Scanner] Scale barcode detected: PLU="${scaleData.plu}", price=${scaleData.price}`);
            const byPlu = await window.api.inventory.getByBarcode(scaleData.plu);
            if (!byPlu) {
              console.warn(`[Scanner] PLU "${scaleData.plu}" not found in inventory`);
              setNotice(`Scale label: PLU "${scaleData.plu}" nahi mila. Pehle product ki barcode/SKU mein PLU "${scaleData.plu}" set karein.`);
              return;
            }
            console.log(`[Scanner] Product found: "${byPlu.name}" (id=${byPlu.id}), adding with scale_price=${scaleData.price}`);
            addProduct(byPlu, {
              scale_plu: scaleData.plu,
              scale_price: scaleData.price,
            });
            setScannerLastSeen(Date.now());
            return;
          }

          // --- Normal barcode scan ---
          console.log(`[Scanner] Normal barcode: "${barcode}" (length=${barcode.length}) attempt ${attempt}/${MAX_RETRIES}`);
          const p = await window.api.inventory.getByBarcode(barcode);
          if (!p) {
            if (attempt < MAX_RETRIES) {
              console.warn(`[Scanner] Barcode "${barcode}" not found, retrying in ${RETRY_DELAY}ms...`);
              await new Promise((r) => setTimeout(r, RETRY_DELAY));
              continue;
            }
            console.warn(`[Scanner] Barcode "${barcode}" not found in inventory after ${MAX_RETRIES} attempts`);
            setNotice(`Barcode ${barcode} not found in inventory`);
            return;
          }
          console.log(`[Scanner] Product found: "${p.name}" (id=${p.id})`);
          const units = (p as any).units || [];
          let selectedUnitLevel = 0;
          for (let i = 0; i < units.length; i++) {
            if (units[i].barcode === barcode) {
              selectedUnitLevel = i;
              break;
            }
          }
          addProduct({ ...p, selected_unit_level: selectedUnitLevel } as any);
          setScannerLastSeen(Date.now());
          return;
        } catch (e) {
          lastError = e;
          if (attempt < MAX_RETRIES) {
            console.warn(`[Scanner] Scan error on attempt ${attempt}, retrying...`);
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
          }
        }
      }
      setNotice(lastError instanceof Error ? lastError.message : String(lastError ?? 'Scan failed'));
    },
    [addProduct]
  );

  const doHold = useCallback(() => {
    if (items.length === 0) return;
    window.api.sales
      .hold('held', `${items.length} items`, { 
        // Persist the FULL cart line. Saving only a subset (the pre-2.15.2 bug)
        // dropped name/retail_price/wholesale_price/cost_price, so Resume rendered
        // an empty price box and NaN totals.
        items: items.map(serializeCartLine),
        customer_id: customerId || null, 
        bill_discount: Number(billDiscount) || 0, 
        discount_type: discountType, 
        price_mode: priceMode,
        service_charge: Number(serviceCharge) || 0,
        service_charge_type: serviceChargeType,
        freight: freightAmt,
      })
      .then(() => {
        setItems([]);
        setBillDiscount('');
        setNotice('Bill held. Use "Held" to resume.');
        // Save for repeat
        setLastSaleItems([...items]);
        setLastSaleCustomer(customerId);
      updateHeldCounts();
      })
      .catch((e) => setNotice(e.message));
  }, [items, customerId, billDiscount, discountType, priceMode]);

const newBill = useCallback(() => {
  setItems([]);
  setSearch('');
  setBillDiscount('');
  setAutoAppliedDiscount(false);
  setDiscountRemoved(false);
  setDiscountSource('none');
  setSuccess(null);
  setQuotationMode(false);
  negStockWarnedRef.current = false; // Phase 1: one negative-stock toast per bill
  switchPriceMode('retail');
  // Reset price edit state
  setPriceEditEnabled(userRole !== 'cashier');
  setPriceEditUnlockOpen(false);
  setPriceEditUserId(null);
  setPriceEditPin('');
  searchRef.current?.focus();
}, [switchPriceMode, userRole]);

useEffect(() => {
  window.api.customers.list().then(setCustomers).catch((e) => setNotice(e.message));
  window.api.auth
    .currentUser()
    .then((u) => setUserRole(u?.role ?? null))
    .catch(() => setUserRole(null));
}, []);

  // Load inventory categories + all active products for the browse panel on the bill screen
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.api.inventory.list(),
      window.api.inventory.categories(),
    ])
      .then(([prods, cats]) => {
        if (cancelled) return;
        setAllProducts(prods);
        setCategories(cats);
      })
      .catch((e) => {
        if (!cancelled) setNotice(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  // ── Load shortcuts + auto-print setting from admin settings ──
  useEffect(() => {
    window.api.admin.shortcuts.getAll().then((rows) => {
      const map: Record<string, string> = {};
      for (const r of rows) map[r.action] = r.shortcut_key;
      setShortcutMap(map);
    }).catch(() => undefined);
    window.api.admin.settings.get('auto_print_receipt').then((v) => {
      setAutoPrintReceipt(v === 'true' || v === '1');
    }).catch(() => undefined);
    window.api.admin.settings.get('scanner_buffer_gap').then((v) => {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) bufferGapRef.current = n;
    }).catch(() => undefined);
    window.api.receipt.getTemplates().then(setReceiptTemplates).catch(() => setReceiptTemplates([]));
    window.api.admin.settings.get('receipt_template').then((v) => {
      if (v) setReceiptTemplate(v);
    }).catch(() => undefined);
    const off = window.api.admin.settings.onChange?.(() => {
      window.api.admin.shortcuts.getAll().then((rows) => {
        const map: Record<string, string> = {};
        for (const r of rows) map[r.action] = r.shortcut_key;
        setShortcutMap(map);
      }).catch(() => undefined);
      window.api.admin.settings.get('auto_print_receipt').then((v) => {
        setAutoPrintReceipt(v === 'true' || v === '1');
      }).catch(() => undefined);
      window.api.admin.settings.get('scanner_buffer_gap').then((v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) bufferGapRef.current = n;
      }).catch(() => undefined);
    });
    return () => { if (off) off(); };
  }, []);

  useEffect(() => { updateHeldCounts(); }, []);

  // ── Soft refresh: reload data without a full page reload (avoids hangs) ──
  const refreshData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [prods, cats, custs, sh] = await Promise.all([
        window.api.inventory.list(),
        window.api.inventory.categories(),
        window.api.customers.list(),
        window.api.shifts.current().catch(() => null),
      ]);
      setAllProducts(prods);
      setCategories(cats);
      setCustomers(custs);
      setShift(sh ?? null);
      const held = await window.api.sales.heldBills('held');
      setHeldCount(held.length);
      const quotes = await window.api.sales.heldBills('quotation');
      setQuotationCount(quotes.length);
      setNotice('Data refreshed');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // adjust price‑edit enable flag when role changes
  useEffect(() => {
    setPriceEditEnabled(userRole !== 'cashier');
  }, [userRole]);

  useEffect(() => {
    // Load manager users, price floor setting, and negative stock settings
    window.api.users.list().then(setManagerUsers).catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
    window.api.settings.getAll().then((s) => {
      setPriceFloorEnabled(s['price_floor_enabled'] !== '0');
      const escOn = s['escape_refresh_enabled'];
      if (escOn !== undefined) setEscapeGestureEnabled(escOn !== 'false' && escOn !== '0');
      const escWin = Number(s['escape_double_tap_window_ms']);
      if (Number.isFinite(escWin) && escWin > 0) setEscapeDoubleTapWindowMs(escWin);
      const v = s['allow_negative_stock'];
      setAllowNegativeStock(parseNegativeStockPolicy(v));
      const maxNeg = Number(s['max_negative_qty'] ?? 0);
      setMaxNegativeQty(Number.isFinite(maxNeg) ? maxNeg : 0);
    }).catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    window.api.shifts
      .current()
      .then(setShift)
      .catch(() => setShift(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setActiveSearchIndex(0);
    const t = window.setTimeout(() => {
      window.api.inventory
        .list(search.trim() || undefined)
        .then((r) => {
          if (!cancelled) { setResults(r); }
        })
        .catch((e) => {
          if (!cancelled) setNotice(e.message);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [search]);

  // =====================================================================
  // ENHANCEMENT FUNCTIONS
  // =====================================================================

  // Toggle favorite/pinned product
  const toggleFavorite = useCallback((productId: number) => {
    setFavorites((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  }, []);

  // ── Express Checkout: one-click cash sale ──
  const expressCheckout = useCallback(async (opts?: { forcePrint?: boolean; silent?: boolean }) => {
    if (items.length === 0 || expressBusy) return false;
    const expired = items.filter((i) => i.expired);
    if (expired.length > 0) { setExpiredConfirm(expired); return false; }
    if (priceFloorEnabled) {
      const belowCost = items.filter((i) => {
        if (i.scale_price != null && i.scale_weight_kg != null && i.scale_weight_kg > 0) {
          return i.price < i.cost_price * i.scale_weight_kg;
        }
        return i.price < i.cost_price;
      });
      if (belowCost.length > 0) { setBelowCostConfirm(belowCost); return false; }
    }
    setExpressBusy(true);
    try {
      warnNegativeStockOnce();
      const rows = [{ mode: 'Cash', amount: finalTotal }];
      const result = await window.api.sales.create({
        items: items.map((i) => {
          if (i.scale_price != null && i.scale_weight_kg != null && i.scale_weight_kg > 0) {
            const pricePerKg = Math.round((i.scale_price / i.scale_weight_kg) * 100) / 100;
            return { product_id: i.product_id, qty: Math.round(i.scale_weight_kg * 1000) / 1000, price: pricePerKg, line_discount: i.line_discount, tax_rate: i.tax_rate, box_qty: undefined, unit_name: 'Gram', display_qty: Math.round((i.scale_weight_g ?? 0) * 1000) / 1000 };
          }
          const units = i.units || [];
          const sel = units[i.selected_unit_level] || units[0];
          const mult = sel?.quantity_in_base_units || 1;
          const raw = Math.round((i.qty / mult) * 1e9) / 1e9;
          return { product_id: i.product_id, qty: i.qty, price: i.price, line_discount: i.line_discount, tax_rate: i.tax_rate, box_qty: i.box_qty, unit_name: sel?.name ?? null, display_qty: Math.round(raw * 1e6) / 1e6 };
        }),
        customer_id: customerId ? Number(customerId) : null,
        bill_discount: Number(billDiscount) || 0, discount_type: discountType,
        discount_source: discountSource === 'none' ? undefined : discountSource,
        price_floor_override: priceFloorOverride, price_mode: priceMode,
        service_charge: Number(serviceCharge) || 0, service_charge_type: serviceChargeType,
        freight: freightAmt, payments: rows,
      });
      // Save for repeat
      setLastSaleItems([...items]);
      setLastSaleCustomer(customerId);
      if (!opts?.silent) setSuccess(result);
      setItems([]);
      setBillDiscount('');
      setAutoAppliedDiscount(false);
      setDiscountRemoved(false);
      setDiscountSource('none');
      setPriceFloorOverride(false);
      if ((autoPrintReceipt || opts?.forcePrint) && result.sale?.id) {
        window.api.printing.printSale(result.sale.id, receiptTemplate)
          .then((r) => { if (r && r.ok === false) setNotice(`Auto-print failed: ${r.message}`); })
          .catch((e) => setNotice(`Auto-print failed: ${e instanceof Error ? e.message : String(e)}`));
      }
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setExpressBusy(false);
    }
  }, [items, finalTotal, customerId, billDiscount, discountType, discountSource, priceFloorOverride, priceMode, serviceCharge, serviceChargeType, freightAmt, autoPrintReceipt, expressBusy, priceFloorEnabled, receiptTemplate, warnNegativeStockOnce]);

  // ── Repeat Last Sale (F7) ──
  const repeatLastSale = useCallback(() => {
    if (!lastSaleItems || lastSaleItems.length === 0) {
      setNotice('No previous sale to repeat');
      return;
    }
    setItems([...lastSaleItems]);
    setCustomerId(lastSaleCustomer);
    setNotice('Last sale loaded — press Charge to complete');
  }, [lastSaleItems, lastSaleCustomer]);

  // ── Pause / F4 — edit the current bill from the keyboard ─────────────────
  // The cart lines are projected onto the PURE reducer rows; every change is
  // written back through the SAME setItems path the mouse buttons use, so the
  // totals, discount and profit stay consistent (no duplicate maths).
  const billEditRows = useMemo<BillEditRow[]>(
    () =>
      items.map((it, idx) => {
        const units = (it.units ?? []).map((u) => ({
          name: u.name,
          quantity_in_base_units: u.quantity_in_base_units,
          price: u.price ?? null,
        }));
        const level = it.selected_unit_level ?? -1;
        const selected = units[level];
        const multiplier = selected?.quantity_in_base_units || 1;
        return {
          id: `${it.product_id}:${idx}`,
          product_id: it.product_id,
          name: it.name,
          // The reducer works in the UNIT the cashier sees.
          qty: multiplier ? it.qty / multiplier : it.qty,
          unitName: selected?.name ?? null,
          units,
          selectedUnitLevel: level,
          price: it.price,
          retail_price: it.retail_price,
          wholesale_price: it.wholesale_price,
          cost_price: it.cost_price,
          line_discount: it.line_discount,
          tax_rate: it.tax_rate,
          note: it.note,
          isScale: it.scale_price != null && it.scale_weight_kg != null,
          minQty: 1,
          decimals: 3,
        };
      }),
    [items]
  );

  const [billEdit, setBillEdit] = useState<BillEditState>(() =>
    initialBillEditState([], { priceMode })
  );
  /** Which field the Pause mode is typing into. */
  const [billEditFocus, setBillEditFocus] = useState<'qty' | 'price' | 'discount' | 'note' | null>(null);
  /** The last removed row — the 5-second Undo toast. */
  const [undoRow, setUndoRow] = useState<BillEditRow | null>(null);
  /** The cart line that was removed, plus its index — the Undo puts it back. */
  const [undoCartLine, setUndoCartLine] = useState<CartLine | null>(null);
  const [undoIndex, setUndoIndex] = useState(0);

  const startBillEdit = useCallback(() => {
    if (items.length === 0) {
      setNotice('Bill is empty');
      return;
    }
    if (billEditMode) {
      setBillEditMode(false);
      return;
    }
    setBillEdit(initialBillEditState(billEditRows, { priceMode }));
    setBillEditMode(true);
    setNotice('Bill edit mode — ' + BILL_EDIT_HINT);
  }, [items.length, billEditMode, billEditRows, priceMode]);

  /** Write the reducer's rows back into the cart (the mouse-button path). */
  const applyBillEditRows = useCallback((rows: BillEditRow[]) => {
    setItems((prev) =>
      prev.map((it, idx) => {
        const row = rows[idx];
        if (!row) return it;
        const units = it.units ?? [];
        const selected = units[row.selectedUnitLevel];
        const multiplier = selected?.quantity_in_base_units || 1;
        const nextQty = row.qty * multiplier;
        const nextPrice =
          row.selectedUnitLevel === (it.selected_unit_level ?? -1)
            ? row.price
            : row.price;
        return {
          ...it,
          qty: nextQty,
          price: nextPrice,
          line_discount: row.line_discount,
          note: row.note,
        };
      })
    );
  }, []);

  /** Route one key press into the bill-edit reducer. Returns true when handled. */
  const handleBillEditKey = useCallback(
    (e: KeyboardEvent): boolean => {
      const action = billEditKeyAction({ key: e.key, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
      const current = billEdit;
      let next: BillEditState = current;
      switch (action) {
        case 'move-up':
          next = billEditReducer(current, { type: 'move', to: 'up' });
          break;
        case 'move-down':
          next = billEditReducer(current, { type: 'move', to: 'down' });
          break;
        case 'move-home':
          next = billEditReducer(current, { type: 'move', to: 'home' });
          break;
        case 'move-end':
          next = billEditReducer(current, { type: 'move', to: 'end' });
          break;
        case 'qty-up':
          next = billEditReducer(current, { type: 'qty-step', delta: 1 });
          break;
        case 'qty-down':
          next = billEditReducer(current, { type: 'qty-step', delta: -1 });
          break;
        case 'qty-edit':
          // Enter or a digit focuses the quantity field with the text selected.
          next = billEditReducer(current, { type: 'qty-text', text: current.qtyText });
          setBillEditFocus('qty');
          break;
        case 'price-edit':
          next = billEditReducer(current, { type: 'price-text', text: current.priceText });
          setBillEditFocus('price');
          break;
        case 'discount-edit':
          next = billEditReducer(current, { type: 'discount-text', text: current.discountText });
          setBillEditFocus('discount');
          break;
        case 'note-edit':
          next = billEditReducer(current, { type: 'note-text', text: current.noteText });
          setBillEditFocus('note');
          break;
        case 'unit':
          next = billEditReducer(current, { type: 'unit' });
          break;
        case 'remove': {
          const removed = current.rows[current.selectedIndex];
          next = billEditReducer(current, { type: 'remove' });
          if (removed) {
            // The row leaves the cart too (the reducer keeps the undo entry).
            const idx = current.selectedIndex;
            setItems((prev) => prev.filter((_, i) => i !== idx));
            // 5-second Undo toast.
            setUndoRow(removed);
            setUndoCartLine(items[idx] ?? null);
            setUndoIndex(idx);
            window.setTimeout(() => setUndoRow((r) => (r && r.id === removed.id ? null : r)), 5000);
          }
          break;
        }
        case 'undo':
          next = billEditReducer(current, { type: 'undo' });
          break;
        case 'exit':
          setBillEditMode(false);
          return true;
        default:
          return false;
      }
      if (next !== current) {
        setBillEdit(next);
        if (action !== 'remove') applyBillEditRows(next.rows);
        if (next.warning) setNotice(next.warning);
      }
      e.preventDefault();
      return true;
    },
    [billEdit, applyBillEditRows, items]
  );
  // ── Customer phone lookup ──
  const handlePhoneLookup = useCallback(async (query: string) => {
    if (!query || query.length < 3) return;
    const phoneMatch = query.replace(/\D/g, '');
    if (phoneMatch.length >= 10) {
      const cust = customers.find((c) => {
        const cPhone = (c.phone || '').replace(/\D/g, '');
        return cPhone.endsWith(phoneMatch.slice(-10));
      });
      if (cust) {
        setCustomerId(String(cust.id));
        setNotice(`Customer auto-selected: ${cust.name}`);
      }
    }
  }, [customers]);

  // ── Profit calculation for owner ──
  useEffect(() => {
    if (userRole !== 'owner' || items.length === 0) { setProfitLive(null); return; }
    let totalCost = 0;
    let totalRevenue = 0;
    for (const it of items) {
      const promo = promoMap[it.product_id];
      const unit = promo ? promo.effective_price : it.price;
      totalCost += it.cost_price * it.qty;
      totalRevenue += unit * it.qty - it.line_discount;
    }
    const margin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
    setProfitLive({ cost: totalCost, revenue: totalRevenue, margin: Math.round(margin * 10) / 10 });
  }, [items, promoMap, userRole]);

  const payTotal = payRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  // ── Print Invoice — shared by the "Print Invoice" button and Ctrl+P double-press ──
  const handlePrintInvoice = useCallback(() => {
    if (!success?.sale?.id) return;
    window.api.printing
      .printInvoice(success.sale.id)
      .then((r) => { if (r && r.ok === false) setNotice(r.message); })
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, [success]);

  // ── Keyboard shortcuts handler ──
  useEffect(() => {
    let buffer = '';
    let last = 0;
    let burstCount = 0;

    const closeTopModal = (): boolean => {
      if (splitModalOpen) { setSplitModalOpen(false); return true; }
      if (payOpen) { setPayOpen(false); return true; }
      if (success) { setSuccess(null); return true; }
      if (voidTarget) { setVoidTarget(null); return true; }
      if (expiredConfirm) { setExpiredConfirm(null); return true; }
      if (belowCostConfirm) { setBelowCostConfirm(null); return true; }
      if (priceEditUnlockOpen) { setPriceEditUnlockOpen(false); return true; }
      if (heldModal) { setHeldModal(null); return true; }
      if (returnConfirmOpen) { setReturnConfirmOpen(false); return true; }
      if (returnFindOpen) { setReturnFindOpen(false); return true; }
      if (showShortcutsModal) { setShowShortcutsModal(false); return true; }
      if (shortcutModalOpen) { setShortcutModalOpen(false); return true; }
      if (cashDrawerOpen) { setCashDrawerOpen(false); return true; }
      if (openShiftModal) { setOpenShiftModal(false); return true; }
      if (closeShiftModal) { setCloseShiftModal(null); return true; }
      if (custModal) { setCustModal(false); return true; }
      if (qtyDialog) { setQtyDialog(null); return true; }
      if (searchOpen) { setSearchOpen(false); return true; }
      return false;
    };

    const dispatchAction = (action: string) => {
      const desc = shortcutMap[action];
      switch (action) {
        case 'new_sale':
          newBill();
          searchRef.current?.focus();
          break;
        case 'hold_bill':
          if (items.length === 0) setNotice('Cart is empty — nothing to hold');
          else doHold();
          break;
        case 'recall_bill':
          openHeld('held');
          break;
        case 'new_return':
          openReturnFlow();
          break;
        case 'search':
          searchRef.current?.focus();
          break;
        case 'duplicate_sale':
          repeatLastSale();
          break;
        case 'cash_drawer':
          if (!shift) setNotice('No open shift for this cash drawer');
          else setCashDrawerOpen(true);
          break;
        case 'logout':
          onLogout?.();
          break;
        case 'quit':
          window.api.app.quit();
          break;
        case 'admin_panel':
          onNavigate?.('admin');
          break;
        case 'reports':
          onNavigate?.('reports');
          break;
        case 'settings':
          onNavigate?.('settings');
          break;
        case 'save':
          if (busy) break;
          if (items.length === 0) {
            setNotice('Cart is empty — nothing to save');
          } else if (quotationMode) {
            completeQuotation();
          } else {
            openPay();
          }
          break;
        case 'save_print':
          // Same path as the hard-coded Ctrl+Shift+S chord above. Reachable when
          // the owner rebinds save+print, and on the web where it is offered as
          // Ctrl+Alt+S because Edge/Firefox reserve Ctrl+Shift+S.
          if (busy) break;
          if (quotationMode) completeQuotation();
          else if (items.length === 0) setNotice('Cart is empty — nothing to save');
          else expressCheckout({ forcePrint: true, silent: true }).then((ok) => { if (ok) newBill(); });
          break;
        case 'print':
          if (success) {
            window.api.printing
              .printSale(success.sale.id, receiptTemplate, { duplicate: true })
              .then((r) => { if (r && r.ok === false) setNotice(r.message); })
              .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
          } else {
            setNotice('No completed sale to print');
          }
          break;
        case 'customer_search':
          // F6 — open the customer combobox from anywhere on Billing.
          setCustomerSearchSignal((n) => n + 1);
          break;
        case 'bill_focus':
          // Pause / F4 — edit the current bill from the keyboard.
          startBillEdit();
          break;
        default:
          setNotice(`Shortcut "${desc || action}" is not available on the billing screen`);
      }
    };

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // 1) Escape closes the top-most open modal before any other shortcut runs
      if (e.key === 'Escape') {
        if (closeTopModal()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // The bill-edit mode is the top-most thing open: Esc leaves it.
        if (billEditMode) {
          e.preventDefault();
          e.stopPropagation();
          setBillEditMode(false);
          return;
        }
        // Nothing is open: Esc refreshes the page (the bill is never touched).
        const decision = runEscapeGesture(Date.now(), {
          enabled: escapeGestureEnabled,
          windowMs: escapeDoubleTapWindowMs,
          context: { hasTopLayer: false, busy, onBilling: true },
        });
        if (decision.action === 'refresh') {
          e.preventDefault();
          e.stopPropagation();
          // The bill (cart, held bills, customer, discounts, notes) is kept:
          // only products, customers, the shift and the settings are reloaded.
          setSearch('');
          setSearchOpen(false);
          void refreshData();
          searchRef.current?.focus();
          setNotice('Refreshed');
          return;
        }
        if (decision.action === 'go-billing') {
          e.preventDefault();
          e.stopPropagation();
          searchRef.current?.focus();
          return;
        }
        return;
      }

      // Sales History owns the keyboard while open. There is no F5/Ctrl+R
      // handler in that dialog: only its Refresh button reloads the timeline.
      if (history) return;

      // The bill-edit mode owns the keyboard while it is on.
      if (billEditMode) {
        if (handleBillEditKey(e)) return;
      }

      // 2) Enter confirms payment while the Payment modal is open
      if ((e.key === 'Enter' || e.key === '\r' || e.key === '\n') && payOpen) {
        if (payTotal > 0 && !busy) {
          e.preventDefault();
          completeSale();
        }
        return;
      }

      // 2.5) Ctrl+Shift+S — Alias for one-click save (same as Ctrl+S).
      // Kept for muscle memory and web where Ctrl+S may be reserved.
      if (e.ctrlKey && !e.altKey && e.shiftKey && keyFromEvent(e) === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        if (items.length === 0) { setNotice('Cart is empty — nothing to save'); return; }
        if (quotationMode) { completeQuotation(); return; }
        expressCheckout({ forcePrint: true, silent: true }).then((ok) => { if (ok) newBill(); });
        return;
      }

      // 2.6) Ctrl+P — print the last completed sale (replaces the double-press
      //      focus/print dance). preventDefault suppresses the native dialog.
      if (e.ctrlKey && !e.altKey && keyFromEvent(e) === 'p') {
        e.preventDefault();
        e.stopPropagation();
        if (success) handlePrintInvoice();
        else setNotice('No completed sale to print yet');
        return;
      }

      // 2.7) Ctrl+S — Save: one-click express cash sale (like Ctrl+Shift+S).
      // Opens payment modal only when Alt is held (Ctrl+Alt+S) or in quotation mode.
      // 2.7) Ctrl+S — First press shows notice, double-press within 500ms completes bill
      if (e.ctrlKey && !e.altKey && keyFromEvent(e) === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        if (items.length === 0) { setNotice('Cart is empty — nothing to save'); return; }
        if (quotationMode) { completeQuotation(); return; }

        const now = Date.now();
        const DOUBLE_PRESS_WINDOW = 500; // ms

        if (now - ctrlSPressTime <= DOUBLE_PRESS_WINDOW) {
          // Double press detected — complete bill (save only, NO print)
          setCtrlSPressTime(0); // reset
          expressCheckout({ forcePrint: false, silent: true }).then((ok) => { if (ok) newBill(); });
        } else {
          // First press — show hint
          setCtrlSPressTime(now);
          setNotice('Press Ctrl+S again to complete bill (no print). Ctrl+Shift+S = save & print. Ctrl+Alt+S = payment options.');
          // Clear notice after timeout
          setTimeout(() => setNotice((n) => n === 'Press Ctrl+S again to complete bill (no print). Ctrl+Shift+S = save & print. Ctrl+Alt+S = payment options.' ? null : n), DOUBLE_PRESS_WINDOW + 200);
        }
        return;
      }
      // 2.8) Ctrl+Alt+S — Open payment modal (for card/udhaar/split payments)
      if (e.ctrlKey && e.altKey && keyFromEvent(e) === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        if (items.length === 0) { setNotice('Cart is empty — nothing to save'); return; }
        if (quotationMode) { completeQuotation(); return; }
        openPay();
        return;
      }

      // 3) Core billing keys (F2/F5/F7/F8/F9/F12) take precedence over the
      //    admin-assigned bindings. The combos come from the shared registry.
      const combo = eventCombo(e);
      if (combo === BILLING_KEYS.search) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (combo === BILLING_KEYS.newBill) {
        e.preventDefault();
        if (items.length === 0) setNotice('Cart is empty — nothing to clear');
        else { newBill(); setNotice('New bill started'); }
        return;
      }
      if (combo === BILLING_KEYS.repeat) { e.preventDefault(); repeatLastSale(); return; }
      if (combo === BILLING_KEYS.express) {
        e.preventDefault();
        if (items.length === 0) setNotice('Cart is empty — add items before Express Checkout');
        else expressCheckout();
        return;
      }
      if (combo === BILLING_KEYS.hold) {
        e.preventDefault();
        if (items.length === 0) setNotice('Cart is empty — nothing to hold');
        else doHold();
        return;
      }
      if (combo === BILLING_KEYS.held) { e.preventDefault(); openHeld('held'); return; }

      // 4) Admin-configured shortcuts, scoped to the billing screen so a combo
      //    that means something else elsewhere (e.g. F5 = Add product on
      //    Inventory) can never fire here. An action with a second default
      //    (bill_focus: Pause + F4) fires on either of them. The two new
      //    actions are always candidates, so a shop whose admin table has not
      //    been seeded yet still gets F6 and Pause.
      const candidateActions = Array.from(
        new Set([...Object.keys(shortcutMap), 'customer_search', 'bill_focus']),
      );
      const action = candidateActions.find(
        (a) =>
          isActionAllowedOn(a, 'billing') &&
          resolveCombos(a, shortcutMap).some((combo) => matchesShortcut(combo, e)),
      );
      if (action) {
        e.preventDefault();
        dispatchAction(action);
        return;
      }

      // 4.5) Browse-grid keyboard navigation (mouse-free POS mode)
      if (!inField) {
        const bpCount = browseProducts.length;
        if (bpCount > 0 && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const base = browseIndex < 0 ? 0 : browseIndex;
          const idx = (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
            ? (base - 1 + bpCount) % bpCount
            : (base + 1) % bpCount;
          setBrowseIndex(idx);
          setPendingQty(1);
          const els = browseListRef.current?.querySelectorAll<HTMLButtonElement>('.browse-item');
          els?.[idx]?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (browseIndex >= 0 && browseIndex < bpCount && (e.key === '+' || e.key === '=' || e.key === '-')) {
          e.preventDefault();
          setPendingQty((q) => Math.max(1, Math.min(999, q + (e.key === '-' ? -1 : 1))));
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Enter' || e.key === '\r' || e.key === '\n')) {
          if (browseIndex >= 0 && browseIndex < bpCount) {
            e.preventDefault();
            openQtyDialog(browseProducts[browseIndex]);
            return;
          }
        }
      }

      // 4.6) Zone navigation — mouse-free chain: search ⇄ browse ⇄ cart ⇄ summary ⇄ buttons
      if (!inField) {
        const rows = Array.from(cartListRef.current?.querySelectorAll<HTMLElement>('.cart-row') ?? []).filter((el) => !(el as HTMLElement).dataset.staged);

        // Tab / Shift+Tab transitions between zones
        if (e.key === 'Tab') {
          if (kbZone === 'browse') {
            e.preventDefault();
            if (e.shiftKey) { searchRef.current?.focus(); setKbZone('search'); }
            else if (rows.length > 0) { setKbZone('cart'); setCartSelIdx(0); focusCartRow(0); }
            return;
          }
          if (kbZone === 'cart') {
            e.preventDefault();
            if (e.shiftKey) return; // Shift+Tab on cart handled separately below
            setKbZone('summary'); setSummarySelIdx(0); focusSummaryField(0);
            return;
          }
          if (kbZone === 'summary') {
            e.preventDefault();
            setKbZone('buttons'); setBtnSelIdx(0); focusActionBtn(0);
            return;
          }
          if (kbZone === 'buttons') {
            e.preventDefault();
            setKbZone('search'); setCartSelIdx(-1); searchRef.current?.focus();
            return;
          }
        }

        // Browse last->first boundary & first->search boundary (wraps preserved for grid, edges route zones)
        const bpCount = browseProducts.length;
        if (kbZone === 'browse') {
          if (e.key === 'ArrowDown' && browseIndex >= bpCount - 1) {
            if (rows.length > 0) { e.preventDefault(); setKbZone('cart'); setCartSelIdx(0); focusCartRow(0); }
            return;
          }
        }

        // Cart zone
        if (kbZone === 'cart' && cartSelIdx >= 0 && cartSelIdx < rows.length) {
          const cur = rows[cartSelIdx];
          const qtyEl = cur.querySelector<HTMLInputElement>('.line-qty-input, .qty-input, input[type=number]');
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (cartSelIdx === 0) {
              if (bpCount > 0) { setKbZone('browse'); setBrowseIndex(bpCount - 1); setPendingQty(1); focusBrowseItem(bpCount - 1); }
              else { setKbZone('search'); setCartSelIdx(-1); searchRef.current?.focus(); }
            } else { setCartSelIdx(cartSelIdx - 1); focusCartRow(cartSelIdx - 1); }
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (cartSelIdx === rows.length - 1) {
              setKbZone('summary'); setSummarySelIdx(0); focusSummaryField(0);
            } else { setCartSelIdx(cartSelIdx + 1); focusCartRow(cartSelIdx + 1); }
            return;
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            const it = items[cartSelIdx];
            if (it) adjustLineQty(cartSelIdx, (it.qty ?? 1) + 1);
            return;
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const it = items[cartSelIdx];
            if (it) adjustLineQty(cartSelIdx, Math.max(1, (it.qty ?? 1) - 1));
            return;
          }
          if ((e.key === 'Enter' || e.key === '\r' || e.key === '\n') || e.key === ' ') {
            e.preventDefault();
            setKbZone('cart');
            if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
              qtyEl?.focus();
              qtyEl?.select?.();
            }
            return;
          }
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            removeCartLine(cartSelIdx);
            setCartSelIdx(Math.min(cartSelIdx, rows.length - 2));
            return;
          }
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            setKbZone('summary'); setSummarySelIdx(0); focusSummaryField(0);
            return;
          }
          if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            if (bpCount > 0) { setKbZone('browse'); setBrowseIndex(bpCount - 1); setPendingQty(1); focusBrowseItem(bpCount - 1); }
            return;
          }
        }

        // Buttons zone
        if (kbZone === 'buttons' && btnSelIdx >= 0) {
          const btns = Array.from(actionPanelRef.current?.querySelectorAll<HTMLElement>('[data-btn-idx]') ?? []);
          if (btns.length === 0) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const next = (e.key === 'ArrowRight' ? btnSelIdx + 1 : btnSelIdx - 1 + btns.length) % btns.length;
            setBtnSelIdx(next); focusActionBtn(next);
            return;
          }
          if (e.key === 'Enter' || e.key === '\r' || e.key === '\n' || e.key === ' ') {
            e.preventDefault();
            (btns[btnSelIdx] as HTMLElement)?.click();
            return;
          }
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault(); setKbZone('search'); setCartSelIdx(-1); searchRef.current?.focus();
            return;
          }
          if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault(); setKbZone('summary'); setSummarySelIdx(0); focusSummaryField(0);
            return;
          }
        }
      }

      // 5) Barcode / scanner buffer for bare keystrokes outside fields
      if (inField) return;
      const now = Date.now();
      if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
        const buf = buffer;
        buffer = '';
        last = now;
        if (buf.length >= 6) {
          console.log(`[Scanner] Raw input: "${buf}" (length=${buf.length})`);
          setScannerLastSeen(Date.now());
          scanAdd(buf);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (now - last > bufferGapRef.current) { buffer = ''; burstCount = 0; }
        buffer += e.key;
        last = now;
        burstCount++;
        if (burstCount >= 4) setScannerLastSeen(Date.now());
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [scanAdd, newBill, doHold, shortcutMap, repeatLastSale, expressCheckout, items, payTotal, shift, payOpen, success, heldModal, expiredConfirm, belowCostConfirm, showShortcutsModal, splitModalOpen, cashDrawerOpen, busy, receiptTemplate, completeSale, openHeld, onNavigate, onLogout, voidTarget, priceEditUnlockOpen, shortcutModalOpen, openShiftModal, closeShiftModal, custModal, searchOpen, quotationMode, openPay, completeQuotation, browseProducts, browseIndex, openQtyDialog, handlePrintInvoice, openReturnFlow, returnConfirmOpen, returnFindOpen, history, handleBillEditKey, billEditMode, customerSearchSignal]);

  // Apply round-off
  const applyRoundOff = useCallback(() => {
    if (roundOffEnabled) {
      const diff = finalTotal - grandTotal;
      setFreight((prev) => {
        const current = Number(prev) || 0;
        return String(Math.round((current + diff) * 100) / 100);
      });
    }
  }, [roundOffEnabled, finalTotal, grandTotal]);

  // Toggle round-off
  const toggleRoundOff = useCallback((enabled?: boolean) => {
    const newEnabled = enabled ?? !roundOffEnabled;
    setRoundOffEnabled(newEnabled);
    if (newEnabled) {
      applyRoundOff();
    } else {
      setFreight('0');
    }
  }, [roundOffEnabled, applyRoundOff]);

  // The customer currently on the bill (null = walk-in / cash).
  const selectedCustomer = useMemo(
    () => (customerId ? customers.find((c) => String(c.id) === String(customerId)) ?? null : null),
    [customerId, customers]
  );

  // Load customer loyalty & auto-apply default discount when customer changes
  useEffect(() => {
    if (customerId) {
      window.api.customers.list().then((custs) => {
        const cust = custs.find((c) => String(c.id) === customerId);
        if (cust) {
          // Calculate loyalty based on purchase history (mock for now)
          setSelectedCustomerLoyalty({ points: Math.floor(cust.balance / 100), tier: cust.balance > 10000 ? 'Gold' : cust.balance > 5000 ? 'Silver' : 'Bronze' });

          // The customer's price level decides the price of every line.
          if ((cust.price_level ?? 'retail') === 'wholesale') {
            switchPriceMode('wholesale');
          } else if (priceMode === 'wholesale') {
            switchPriceMode('retail');
          }

          // Apply customer default discount using the pure helper.
          setDiscountRemoved(false);
          const result = applyCustomerDiscount({
            customer: cust,
            currentDiscount: billDiscount,
            autoApplied: autoAppliedDiscount,
            billAmount: totals.subtotal,
          });
          setBillDiscount(result.discount);
          setDiscountType(result.type);
          setAutoAppliedDiscount(result.autoApplied);
          setDiscountSource(result.source);
        }
      }).catch(() => undefined);
    } else {
      setSelectedCustomerLoyalty(null);
      // Clear only auto-applied discounts when customer is removed.
      const result = applyCustomerDiscount({
        customer: null,
        currentDiscount: billDiscount,
        autoApplied: autoAppliedDiscount,
      });
      setBillDiscount(result.discount);
      setAutoAppliedDiscount(result.autoApplied);
      setDiscountSource(result.source);
    }
  }, [customerId]);

  // Live re-evaluation: the customer discount follows the bill amount, so a
  // "Rs 50 off above Rs 500" discount kicks in as soon as the bill is big
  // enough (and the hint disappears again). A TYPED discount is never touched.
  useEffect(() => {
    if (!selectedCustomer || discountRemoved) return;
    if (!autoAppliedDiscount) return;
    const result = applyCustomerDiscount({
      customer: selectedCustomer,
      currentDiscount: billDiscount,
      autoApplied: autoAppliedDiscount,
      billAmount: totals.subtotal,
    });
    if (result.discount === billDiscount && result.type === discountType) return;
    setBillDiscount(result.discount);
    setDiscountType(result.type);
    setAutoAppliedDiscount(result.autoApplied);
    setDiscountSource(result.source);
  }, [selectedCustomer, totals.subtotal, autoAppliedDiscount, discountRemoved]);

  // "Add Rs X more to get the Rs 50 discount"
  const customerDiscountHint = useMemo(() => {
    if (!selectedCustomer || discountRemoved) return '';
    const minBill = Number(selectedCustomer.discount_min_bill ?? 0);
    const value = Number(selectedCustomer.default_discount_pct ?? 0);
    if (!Number.isFinite(minBill) || minBill <= 0) return '';
    if (!Number.isFinite(value) || value <= 0) return '';
    return minBillHint(minBill, totals.subtotal);
  }, [selectedCustomer, totals.subtotal, discountRemoved]);

  // The badge above the discount fields: "Customer discount 5% applied" /
  // "Customer discount Rs 50 applied", with an x to remove it for this bill.
  const customerDiscountBadgeText = useMemo(() => {
    if (!selectedCustomer || discountRemoved || !autoAppliedDiscount) return '';
    const value = Number(selectedCustomer.default_discount_pct ?? 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const type = selectedCustomer.discount_type === 'fixed' ? 'fixed' : 'percent';
    return customerDiscountBadge(type, value, getCurrencySymbol());
  }, [selectedCustomer, autoAppliedDiscount, discountRemoved]);

  // The customer discount recorded on the sale being inspected.
  const saleDetailDiscountLabel = useMemo(() => {
    if (!saleDetail) return '';
    return describeDiscountSource(
      saleDetail.discount_source,
      saleDetail.customer_discount_amount,
      getCurrencySymbol()
    );
  }, [saleDetail]);

  // The customer discount recorded on a sale event, if any.
  const historyDetailSnapshotDiscount = useMemo(() => {
    if (!historyDetail || historyDetail.snapshot == null || typeof historyDetail.snapshot !== 'object') {
      return '';
    }
    const snap = historyDetail.snapshot as Record<string, unknown>;
    return describeDiscountSource(
      snap.discount_source,
      snap.customer_discount_amount,
      getCurrencySymbol()
    );
  }, [historyDetail]);

  const removeCustomerDiscount = useCallback(() => {
    setDiscountRemoved(true);
    setAutoAppliedDiscount(false);
    setBillDiscount('');
    setDiscountSource('none');
  }, []);

  // Open shortcut modal
  const openShortcutModal = useCallback(() => {
    setShortcutModalOpen(true);
  }, []);

  // Open split bill modal
  const openSplitModal = useCallback(() => {
    if (items.length === 0) return;
    const initialSplit: Record<number, number> = {};
    items.forEach((_, idx) => { initialSplit[idx] = 1; });
    setSplitItems(initialSplit);
    setSplitModalOpen(true);
  }, [items]);

  // Calculate tax breakdown
  const taxBreakdown = useMemo(() => {
    const breakdown: Record<number, number> = {};
    items.forEach((it) => {
      const promo = promoMap[it.product_id];
      const unit = promo ? promo.effective_price : it.price;
      const taxable = unit * it.qty - it.line_discount;
      const tax = (taxable * it.tax_rate) / 100;
      if (tax > 0) {
        breakdown[it.tax_rate] = (breakdown[it.tax_rate] || 0) + tax;
      }
    });
    return breakdown;
  }, [items, promoMap]);

  async function handleSearchEnter(index = 0) {
    const q = search.trim();
    if (!q) return;
    const exact = results.find((r) => r.barcode === q || r.sku === q);
    if (exact) {
      addProduct(exact);
      setSearch('');
      setActiveSearchIndex(0);
      return;
    }
    try {
      const byBarcode = await window.api.inventory.getByBarcode(q);
      if (byBarcode) {
        addProduct(byBarcode);
        setSearch('');
        setActiveSearchIndex(0);
        return;
      }
    } catch {
      /* ignore */
    }
    const target = results.length > 0 ? results[Math.min(Math.max(0, index), results.length - 1)] : undefined;
    if (target) {
      addProduct(target);
      setSearch('');
      setActiveSearchIndex(0);
    } else {
      setNotice(`No product found for "${q}"`);
    }
  }

  // ── Receipt style: update state, persist to settings, show feedback ──
  const applyReceiptTemplate = useCallback((id: string) => {
    setReceiptTemplate(id);
    const name = receiptTemplates.find((t) => t.id === id)?.name || id;
    setNotice(`Receipt style set to ${name}`);
    window.api.admin.settings.set('receipt_template', id).catch(() => undefined);
  }, [receiptTemplates]);

function openPay() {
  const expired = items.filter((i) => i.expired);
  if (expired.length > 0) {
    setExpiredConfirm(expired);
    return;
  }
  if (priceFloorEnabled) {
    const belowCost = items.filter((i) => {
      if (i.scale_price != null && i.scale_weight_kg != null && i.scale_weight_kg > 0) {
        const actualCost = i.cost_price * i.scale_weight_kg;
        return i.price < actualCost;
      }
      return i.price < i.cost_price;
    });
    if (belowCost.length > 0) {
      setBelowCostConfirm(belowCost);
      return;
    }
  }
  if (quickAmount && Number(quickAmount) > 0) {
    setPayRows([{ mode: payModeQuick, amount: Number(quickAmount).toFixed(2) }]);
  } else {
    setPayRows([{ mode: 'Cash', amount: finalTotal.toFixed(2) }]);
  }
  setPayOpen(true);
}

  async function completeSale() {
    setBusy(true);
    try {
      warnNegativeStockOnce();
      const rows = payRows
        .map((r) => ({ mode: r.mode, amount: Number(r.amount) || 0 }))
        .filter((r) => r.amount > 0);
        const result = await window.api.sales.create({
          items: items.map((i) => {
            // --- BayLan Scale item: use grams as display unit ---
            if (i.scale_price != null && i.scale_weight_kg != null && i.scale_weight_kg > 0) {
              const pricePerKg = Math.round((i.scale_price / i.scale_weight_kg) * 100) / 100;
              return {
                product_id: i.product_id,
                qty: Math.round(i.scale_weight_kg * 1000) / 1000,
                price: pricePerKg,
                line_discount: i.line_discount,
                tax_rate: i.tax_rate,
                box_qty: undefined,
                unit_name: 'Gram',
                display_qty: Math.round((i.scale_weight_g ?? 0) * 1000) / 1000,
                note: i.note || undefined,
              };
            }
            // --- Normal item ---
            const units = i.units || [];
            const sel = units[i.selected_unit_level] || units[0];
            const mult = sel?.quantity_in_base_units || 1;
            const raw = Math.round((i.qty / mult) * 1e9) / 1e9;
            const dq = Math.round(raw * 1e6) / 1e6;
            return {
              product_id: i.product_id,
              qty: i.qty,
              price: i.price,
              line_discount: i.line_discount,
              tax_rate: i.tax_rate,
              box_qty: i.box_qty,
              unit_name: sel?.name ?? null,
              display_qty: dq,
              note: i.note || undefined,
            };
          }),
          customer_id: customerId ? Number(customerId) : null,
          bill_discount: Number(billDiscount) || 0,
          discount_type: discountType,
          discount_source: discountSource === 'none' ? undefined : discountSource,
          price_floor_override: priceFloorOverride,
          price_mode: priceMode,
          service_charge: Number(serviceCharge) || 0,
          service_charge_type: serviceChargeType,
          freight: freightAmt,
          payments: rows,
        });
      setPayOpen(false);
      setSuccess(result);
      // Save for repeat last sale
      setLastSaleItems([...items]);
      setLastSaleCustomer(customerId);
      setItems([]);
      setBillDiscount('');
      setAutoAppliedDiscount(false);
      setDiscountRemoved(false);
      setDiscountSource('none');
      setPriceFloorOverride(false);
      setPriceFloorUserId(null);
      setPriceFloorPin('');
      // Auto-print receipt if enabled
      if (autoPrintReceipt && result.sale?.id) {
        window.api.printing.printSale(result.sale.id, receiptTemplate)
          .then((r) => { if (r && r.ok === false) setNotice(`Auto-print failed: ${r.message}`); })
          .catch((e) => setNotice(`Auto-print failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function completeQuotation() {
    if (items.length === 0) return;
    setBusy(true);
    try {
      await window.api.sales.hold('quotation', `${items.length} items`, {
        items: items.map(i => ({
          product_id: i.product_id,
          qty: i.qty,
          price: i.price,
          line_discount: i.line_discount,
          tax_rate: i.tax_rate,
          units: i.units,
          selected_unit_level: i.selected_unit_level,
          scale_plu: i.scale_plu,
          scale_price: i.scale_price,
          scale_weight_g: i.scale_weight_g,
          scale_weight_kg: i.scale_weight_kg,
        })),
        customer_id: customerId || null,
        bill_discount: Number(billDiscount) || 0,
        discount_type: discountType,
        price_mode: priceMode,
        service_charge: Number(serviceCharge) || 0,
        service_charge_type: serviceChargeType,
        freight: freightAmt,
      });
      setNotice('Quotation saved. Find it under "Quotes".');
      setItems([]);
      setBillDiscount('');
setQuotationMode(false);
      updateHeldCounts();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openHeld(tab: 'held' | 'quotation') {
    const rows = await window.api.sales.heldBills(tab);
    setHeldModal({ tab, rows });
  }

  async function resumeHeld(h: HeldBill) {
    try {
      // PHASE 3d: record the resume event in the main process before the cart is
      // rehydrated, so the timeline gets the cashier + timestamp of the action.
      const resumed = await window.api.sales.resumeHeld(h.id);
      if (!resumed) throw new Error('Held bill not found');
      const data = JSON.parse(resumed.data);
      const mode: 'retail' | 'wholesale' = data.price_mode === 'wholesale' ? 'wholesale' : 'retail';
      // Re-hydrate each line from the current product data (name, unit list,
      // stock) and coerce every number, so bills held before the full line was
      // saved still resume without NaN. `setPriceMode` (not `switchPriceMode`)
      // keeps any price the cashier edited before holding.
      setItems(rehydrateCartLines(data.items, allProducts, mode));
      setPriceMode(mode);
      setCustomerId(data.customer_id ?? '');
      setBillDiscount(String(data.bill_discount ?? ''));
      setDiscountType(data.discount_type ?? 'amount');
      setServiceCharge(String(data.service_charge ?? ''));
      setServiceChargeType(data.service_charge_type ?? 'amount');
      setFreight(String(data.freight ?? ''));
      setHeldModal(null);
      updateHeldCounts();
    } catch (e) {
      setNotice('Failed to resume bill: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function openHistory() {
    await loadCashiers();
    try {
      const def = await window.api.history.defaults();
      const ui = historyUiFromService({
        ...def,
        // Preserve the existing role restriction: a cashier only sees own events.
        onlyMySales: userRole === 'cashier' ? true : !!def.onlyMySales,
      });
      setHistoryFilters(ui);
      setDatePreset('today');
      setHistoryDetail(null);
      setHistory([]);
      await loadHistory(ui, 1);
    } catch (e) {
      setNotice(String((e as Error)?.message || e));
      setHistory([]);
    }
  }

  async function loadCashiers() {
    try {
      const users = await window.api.users.list();
      setCashiers(users.filter(u => u.role === 'cashier' || u.role === 'owner' || u.role === 'manager'));
    } catch (e) {
      console.error('Failed to load cashiers:', e);
    }
  }

  /** One round-trip set for every panel: rows + summary + chip counts + held badge. */
  async function loadHistory(filters: HistoryUiFilters = historyFilters, page = 1) {
    setHistoryBusy(true);
    try {
      const service = historyUiToService(filters);
      const [list, summary, counts, openHeld] = await Promise.all([
        window.api.history.list(service, page, 50),
        window.api.history.summary(service),
        window.api.history.counts(service),
        window.api.history.openHeldCount(),
      ]);
      setHistory(list.rows);
      setHistoryTotal(list.total);
      setHistoryPage(list.page);
      setHistorySummary(summary);
      setHistoryCounts(counts);
      setHistoryOpenHolds(openHeld);
    } catch (e) {
      setNotice(String((e as Error)?.message || e));
      setHistory((prev) => prev ?? []);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function applyHistoryFilters(page = 1) {
    await loadHistory(historyFilters, page);
  }

  function applyDatePreset(preset: typeof datePreset) {
    if (preset === 'custom') {
      setDatePreset('custom');
      return;
    }
    // Use the shared IPC helper so the 04:00 business-day anchor works.
    window.api.history.presetRange(preset).then((range) => {
      const next = { ...historyFilters, from: range.from, to: range.to };
      setHistoryFilters(next);
      setDatePreset(preset);
      void loadHistory(next, 1);
    }).catch(() => {
      setDatePreset(preset);
    });
  }

  /** Clear Filters always means "Today + All events" (never a blank/unfiltered month). */
  function clearHistoryFilters() {
    const today = toLocalDateString(new Date());
    const next: HistoryUiFilters = {
      ...emptyHistoryUiFilters(),
      from: today,
      to: today,
      onlyMySales: userRole === 'cashier',
    };
    setHistoryFilters(next);
    setDatePreset('today');
    void loadHistory(next, 1);
  }

  function toggleHistoryType(type: HistoryEventType) {
    const allSelected = historyFilters.types.length >= HISTORY_EVENT_TYPES.length;
    let nextTypes: HistoryEventType[];
    if (allSelected) {
      // First click out of "All" narrows to exactly the clicked chip.
      nextTypes = [type];
    } else if (historyFilters.types.includes(type)) {
      nextTypes = historyFilters.types.filter((t) => t !== type);
    } else {
      nextTypes = [...historyFilters.types, type];
    }
    if (nextTypes.length === 0) nextTypes = [...HISTORY_EVENT_TYPES];
    const next = { ...historyFilters, types: nextTypes };
    setHistoryFilters(next);
    void loadHistory(next, 1);
  }

  async function openHistoryDetail(eventId: number) {
    try {
      setHistoryDetail(await window.api.history.detail(eventId));
    } catch (e) {
      setNotice(String((e as Error)?.message || e));
    }
  }

  async function voidFromHistory(e: HistoryEventRow) {
    if (!e.sale_id) return;
    try {
      const sale = await window.api.sales.get(e.sale_id);
      if (!sale) return;
      setVoidTarget(sale as unknown as Sale);
      setVoidReason('');
    } catch (err) {
      setNotice(String((err as Error)?.message || err));
    }
  }

  async function confirmDeleteHeld() {
    if (!holdDeleteTarget || !holdDeleteReason.trim()) return;
    try {
      await window.api.sales.deleteHeld(holdDeleteTarget.id, holdDeleteReason.trim());
      setHoldDeleteTarget(null);
      setHoldDeleteReason('');
      const held = await window.api.sales.heldBills();
      setHeldModal((prev) => (prev ? { ...prev, rows: held } : prev));
      setHeldCount(held.length);
      if (history) await loadHistory(historyFilters, historyPage);
    } catch (e) {
      setNotice(String((e as Error)?.message || e));
    }
  }

  function historyExportRows(): (string | number)[][] {
    return (history ?? []).map((e) => [
      formatDateTimeAdmin(e.occurred_at),
      HISTORY_EVENT_LABELS[e.event_type],
      e.invoice_no ?? '',
      e.customer ?? '',
      e.user ?? '',
      e.payment_mode ?? '',
      e.amount,
      e.reason ?? '',
      e.reference_invoice ?? '',
    ]);
  }

  async function exportHistoryCsv() {
    const headers = ['Time', 'Type', 'Invoice', 'Customer', 'Cashier', 'Payment', 'Amount', 'Reason', 'Reference'];
    await window.api.exportData.saveCsv(
      `sales-history-${historyFilters.from || 'all'}.csv`,
      headers,
      historyExportRows()
    );
  }

  async function exportHistoryExcel() {
    const headers = ['Time', 'Type', 'Invoice', 'Customer', 'Cashier', 'Payment', 'Amount', 'Reason', 'Reference'];
    await window.api.exportData.saveXlsx(`sales-history-${historyFilters.from || 'all'}.xlsx`, [
      { name: 'Sales History', headers, rows: historyExportRows() },
    ]);
  }

  async function openSaleDetail(saleId: number) {
    const detail = await window.api.sales.get(saleId);
    if (!detail) return;
    
    // Compute payment breakdown
    const paymentBreakdown = detail.payments.reduce((acc, p) => {
      acc[p.mode] = (acc[p.mode] || 0) + p.amount;
      return acc;
    }, {} as Record<string, number>);
    
    const saleDetailData = {
      ...detail,
      paymentBreakdown,
      subtotal: detail.items.reduce((s, i) => s + i.line_total, 0),
    };
    
    setSaleDetail(saleDetailData);
  }

  const handleConvertToReturn = () => {
    if (!saleDetail) return;
    const saleId = saleDetail.id;
    setSaleDetail(null);
    // Store sale ID in localStorage for Returns page to pick up, then navigate.
    localStorage.setItem('return_sale_id', String(saleId));
    setNotice('Opening Returns page...');
    onNavigate?.('returns');
  }

  const handleDuplicateAsNewSale = async () => {
    if (!saleDetail) return;
    
    // Fetch all products in parallel to get their units
    const products = await Promise.all(
      saleDetail.items.map(item => 
        window.api.inventory.get(item.product_id)
          .catch(() => null)  // Handle deleted products gracefully
      )
    );
    
    // Check for any failed fetches (deleted products)
    const failedCount = products.filter(p => p === null).length;
    if (failedCount > 0) {
      setNotice(`${failedCount} product(s) no longer available, skipped`);
    }
    
    const items: CartLine[] = [];
    
    for (let idx = 0; idx < saleDetail.items.length; idx++) {
      const item = saleDetail.items[idx];
      const product = products[idx];
      if (!product) continue; // Skip deleted products
      
      // Find matching unit by name (unit_name from sale item)
      const matchedUnit = product.units?.find(u => u.name === item.unit_name);
      const unitLevel = matchedUnit?.level ?? 0;
      
      items.push({
        product_id: item.product_id,
        name: item.product_name ?? `Product #${item.product_id}`,
        qty: item.qty,
        price: item.unit_price,
        retail_price: item.unit_price,
        wholesale_price: null,
        cost_price: 0,
        line_discount: item.discount,
        tax_rate: item.tax_rate,
        expired: false,
        shelf_location: null,
        stock_qty: 0,
        units: product.units ?? [],
        selected_unit_level: unitLevel,
        unit_name: item.unit_name,
        display_qty: item.display_qty,
        note: (item as any).note || undefined,
      });
    }
    
    setItems(items);
    if (saleDetail.customer_id) {
      setCustomerId(String(saleDetail.customer_id));
    }
    setSaleDetail(null);
  }

  async function doVoid() {
    if (!voidTarget || !voidReason.trim()) return;
    try {
      await window.api.sales.void(voidTarget.id, voidReason.trim());
      setVoidTarget(null);
      setVoidReason('');
      if (history) await loadHistory(historyFilters, historyPage);
      setNotice('Sale voided. Stock restored.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function doCloseShift() {
    if (!closeShiftModal) return;
    const counted = Number(countedCash);
    if (Number.isNaN(counted) || counted < 0) {
      setNotice('Enter the counted cash in the drawer');
      return;
    }
    try {
      const r = await window.api.shifts.close(closeShiftModal.id, counted, closeNotes.trim() || undefined);
      const diff = r.variance ?? 0;
      setNotice(
        `Shift closed. Expected ${(r.expected_cash ?? 0).toFixed(2)}, counted ${counted.toFixed(2)}, variance ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`
      );
      setCloseShiftModal(null);
        setShift(null);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    }
    
    const updateHeldCounts = async () => {
      try {
        const held = await window.api.sales.heldBills('held');
        setHeldCount(held.length);
        const quotes = await window.api.sales.heldBills('quotation');
        setQuotationCount(quotes.length);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    };

return (
  <>
    <div className="page billing-page">
      <div className="sale-invoice-bar merged-header">
        <div className="sale-invoice-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span>Sale Invoice</span>
        </div>
        <div className="billing-search-wrap" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <input
            ref={searchRef}
            className="search-input billing-search"
            placeholder="Search, scan barcode, or type phone... (F2)"
            value={search}
            onChange={(e) => { setSearch(e.target.value); handlePhoneLookup(e.target.value); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 180)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const count = results.slice(0, 40).length;
                if (count === 0) return;
                setActiveSearchIndex((prev) =>
                  e.key === 'ArrowDown' ? (prev + 1) % count : (prev - 1 + count) % count
                );
              } else if (e.key === 'Enter') {
                e.preventDefault();
                handleSearchEnter(activeSearchIndex);
              }
            }}
          />
          {searchOpen && search.trim() !== '' && (
            <div className="product-search-dropdown">
              {results.length === 0 ? (
                <div className="psd-empty">Type to search or press F2...</div>
              ) : (
                results.slice(0, 40).map((r, i) => (
                  <button
                    key={r.id}
                    className={`product-search-result${i === activeSearchIndex ? ' active' : ''}`}
                    onMouseEnter={() => setActiveSearchIndex(i)}
                    onClick={() => { addProduct(r); setSearch(''); setActiveSearchIndex(0); }}
                  >
                    <span className="psr-name">{r.name}</span>
                    <span className="psr-meta">
                      {r.sale_price}
                      {r.wholesale_price != null ? ` • W ${r.wholesale_price}` : ''}
                      {r.shelf_location ? ` • ${r.shelf_location}` : ''}
                      <span style={r.stock_qty < 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                        {r.stock_qty > 0
                          ? ` • ${Number(r.stock_qty.toFixed(3))} in stock`
                          : r.stock_qty < 0
                            ? ` • ${Number(r.stock_qty.toFixed(3))} in stock`
                            : ' • out'}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <CustomerCombobox
          customers={customers}
          value={customerId}
          onChange={setCustomerId}
          onNewCustomer={(q) => {
            setQuickCustomerSeed(q);
            setQuickCustomerOpen(true);
          }}
          openSignal={customerSearchSignal}
        />
        <span
          className={`shift-pill ${
            shift
              ? Date.now() - new Date(shift.opened_at).getTime() > 24 * 60 * 60 * 1000
                ? 'warn'
                : 'ok'
              : 'warn'
          }`}
          title={
            shift && Date.now() - new Date(shift.opened_at).getTime() > 24 * 60 * 60 * 1000
              ? 'This shift has been open for more than 24 hours — close and reconcile it'
              : undefined
          }
        >
          {shift
            ? (() => {
                const hours = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(shift.opened_at).getTime()) / 3_600_000)
                );
                return (
                  <>
                    Shift · {formatTimeAdmin(shift.opened_at)} · {shift.start_cash.toFixed(2)}
                    {hours > 24 ? ` · ${hours}h open — reconcile` : ''}
                  </>
                );
              })()
            : 'No shift'}
        </span>
        {shift ? (
          <button className="shift-close-btn" onClick={async () => {
            try {
              const d = await window.api.shifts.get(shift.id);
              setCloseShiftModal(d); setCountedCash(''); setCloseNotes('');
            } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
          }}>Close</button>
        ) : (
          <button className="shift-open-btn" onClick={() => setOpenShiftModal(true)}>Open</button>
        )}
        <button className="sale-inv-icon-btn" title={refreshing ? 'Refreshing…' : 'Refresh'} onClick={() => { void refreshData(); }} disabled={refreshing}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <LiveClock refreshing={refreshing} />
      </div>

      {/* ─── Toolbar row 2: actions ─── */}
      <div className="billing-top">
        <button className="btn btn-sm" onClick={() => setCustModal(true)}>+ Customer</button>
        <button className={quotationMode ? 'btn btn-sm btn-quote active' : 'btn btn-sm btn-quote'} onClick={() => setQuotationMode(!quotationMode)}>
          {quotationMode ? 'Quotation ON' : 'Quotation'}
        </button>
        <button className="btn btn-sm" onClick={() => openHeld('held')}>Held ({heldCount})</button>
        <button className="btn btn-sm" onClick={() => openHeld('quotation')}>Quotes ({quotationCount})</button>
        <button className="btn btn-sm" onClick={openHistory}>History</button>
        <button
          className="btn btn-sm"
          onClick={handleOpenCashDrawer}
          disabled={drawerBusy}
          title="Open cash drawer via receipt printer"
        >
          {drawerBusy ? 'Opening…' : 'Cash Drawer'}
        </button>
        <button className="btn btn-sm" onClick={newBill}>New (F5)</button>
        <span className={`scanner-ind ${scannerConnected ? 'ok' : ''}`} title={scannerConnected ? 'Barcode scanner connected' : 'No barcode scanner detected'}>
          <span className="scanner-dot" />
          {scannerConnected
            ? (scannerLastSeen && (Date.now() - scannerLastSeen < 5000) ? 'Scanner: Active' : 'Scanner: Connected')
            : 'Scanner: Not detected'}
        </span>
      </div>

      {/* ─── Toolbar row 3: express / repeat / return ─── */}
      <div className="billing-top">
        <button
          className="btn btn-sm"
          style={{ background: 'var(--ok)', color: '#fff', fontWeight: 600 }}
          disabled={items.length === 0 || expressBusy || !shift}
          onClick={() => expressCheckout()}
          title="Express checkout — cash payment, one click (F8)"
        >
          {expressBusy ? 'Processing...' : '⚡ Express (F8)'}
        </button>
        <button
          className="btn btn-sm"
          disabled={!lastSaleItems}
          onClick={repeatLastSale}
          title="Repeat last sale items (F7)"
        >
          ↻ Repeat (F7)
        </button>
        <button
          className={`btn btn-sm ${returnMode ? 'btn-danger active' : ''}`}
          onClick={() => {
            setReturnMode(!returnMode);
            if (!returnMode) setNotice('Return mode ON — scan item to return');
            else setNotice(null);
          }}
          title="Toggle return mode — scan items to return"
        >
          {returnMode ? '↩ Return ON' : '↩ Return'}
        </button>
        {profitLive && (
          <span
            className="badge"
            style={{ background: profitLive.margin > 0 ? '#052e16' : '#450a0a', color: profitLive.margin > 0 ? '#22c55e' : '#ef4444', padding: '2px 6px', fontSize: 10 }}
            title={`Cost: ${formatMoney(profitLive.cost)} | Revenue: ${formatMoney(profitLive.revenue)}`}
          >
            Profit: {profitLive.margin}%
          </span>
        )}
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {undoRow && (
        <div className="notice" role="status" aria-live="polite">
          Removed {undoRow.name}{' '}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              // Put the row back in the SAME position with the same qty, unit,
              // discount and note.
              setBillEdit((s) => billEditReducer(s, { type: 'undo' }));
              setItems((prev) => {
                if (!undoCartLine) return prev;
                const next = [...prev];
                const at = Math.max(0, Math.min(next.length, undoIndex));
                next.splice(at, 0, undoCartLine);
                return next;
              });
              setUndoRow(null);
            }}
          >
            Undo
          </button>
        </div>
      )}

      <div className="browse-cats-wrapper card">
        <div className="browse-cats">
          <button
            className={`btn btn-sm browse-chip ${browseCategory === 'all' ? 'active' : ''}`}
            onClick={() => setBrowseCategory('all')}
          >
            All Products
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`btn btn-sm browse-chip ${browseCategory === c.id ? 'active' : ''}`}
              onClick={() => setBrowseCategory(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="billing-row">
        <div className="billing-browse card">
          <div className="browse-list" ref={browseListRef}>
          {browseProducts.length === 0 ? (
            <div className="muted center pad">
              {browseCategory !== 'all'
                ? 'No products in this category.'
                : 'No products found'}
            </div>
          ) : (
            browseProducts.map((p, idx) => {
              const displayPrice = priceMode === 'wholesale' && p.wholesale_price != null
                ? p.wholesale_price
                : p.sale_price;
              const isLowStock = p.stock_qty > 0 && p.stock_qty < LOW_STOCK_THRESHOLD;
              const isFlashing = flashingItemId === p.id;
              const isSelected = browseIndex === idx;
              return (
              <button
                key={p.id}
                data-index={idx}
                className={`browse-item${isSelected ? ' browse-item-selected' : ''}${isFlashing ? ' browse-item-flash' : ''}`}
                onClick={() => {
                  if (clickTimer.current) return;
                  clickTimer.current = window.setTimeout(() => {
                    clickTimer.current = null;
                    addProduct(p);
                    setFlashingItemId(p.id);
                    setTimeout(() => setFlashingItemId(null), 250);
                  }, 220);
                }}
                onDoubleClick={() => {
                  if (clickTimer.current) { window.clearTimeout(clickTimer.current); clickTimer.current = null; }
                  openQtyDialog(p);
                }}
                title={`Add ${p.name} to bill (double-click for quantity)`}
              >
                <div className="browse-thumb">
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="thumb-placeholder">📦</span>}
                </div>
                <div className="browse-item-content">
                  <div className="browse-item-line1">
                    <span className="browse-item-name">{p.name}</span>
                    <span className="browse-item-price">{getCurrencySymbol()} {displayPrice.toLocaleString()}</span>
                  </div>
                  <div className="browse-item-stock-row">
                    {priceMode === 'wholesale' && p.wholesale_price != null && p.wholesale_price !== p.sale_price && (
                      <span className="browse-item-wholesale-badge">W</span>
                    )}
                    {isLowStock && (
                      <span className="browse-item-low-stock-dot" title={`Low stock: ${formatStockQty(p.stock_qty)}`} />
                    )}
                    <span
                      className={`browse-item-stock${isLowStock ? ' low-stock' : ''}${p.stock_qty <= 0 ? ' out-of-stock' : ''}`}
                      style={p.stock_qty < 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}
                    >
                      {p.stock_qty > 0
                        ? `${formatStockQty(p.stock_qty)} in stock`
                        : p.stock_qty < 0
                          ? `${formatStockQty(p.stock_qty)} in stock` // negative: shown red with minus sign
                          : 'Out of stock'}
                    </span>
                    {isSelected && <span className="browse-item-qty-badge">× {pendingQty}</span>}
                  </div>
                </div>
              </button>
              );
            })
          )}
        </div>
      </div>
      <div className="panel panel-cart">
          <div className="panel-title" style={{ borderBottom: '2px solid transparent', backgroundImage: 'linear-gradient(var(--card-bg), var(--card-bg)), linear-gradient(90deg, var(--primary), var(--primary-light))', backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box' }}>
            Current Bill {quotationMode && <span className="badge badge-quote">Quotation</span>}
<span className="mode-toggle">
  <button
    className={priceMode === 'retail' ? 'btn btn-sm btn-quote active' : 'btn btn-sm'}
    onClick={() => {
      if (userRole === 'owner' || userRole === 'manager') {
        switchPriceMode('retail');
      } else {
        setNotice('Only the owner or manager can switch pricing mode.');
      }
    }}
  >
    Retail
  </button>
  <button
    className={priceMode === 'wholesale' ? 'btn btn-sm btn-quote active' : 'btn btn-sm'}
    onClick={() => {
      if (userRole === 'owner' || userRole === 'manager') {
        switchPriceMode('wholesale');
      } else {
        setNotice('Only the owner or manager can switch pricing mode.');
      }
    }}
  >
    Wholesale
  </button>
</span>
{!priceEditEnabled && (
  <button className="btn btn-sm" onClick={() => setPriceEditUnlockOpen(true)}>
    Unlock Prices
  </button>
)}
          </div>
          <div
            className="cart-list"
            role={billEditMode ? 'listbox' : undefined}
            aria-label={billEditMode ? 'Bill items' : undefined}
          >
            {billEditMode && (
              <div className="bill-edit-hint" role="status" aria-live="polite">
                <span>{BILL_EDIT_HINT}</span>
                <span className="muted">{billEdit.announcement}</span>
              </div>
            )}
            {billEditMode && billEditFocus && billEdit.selectedIndex >= 0 && (
              <div className="bill-edit-fields" style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                {billEditFocus === 'qty' && (
                  <input
                    autoFocus
                    className="bsf-input"
                    style={{ width: 110 }}
                    value={billEdit.qtyText}
                    onChange={(e) => setBillEdit((s) => billEditReducer(s, { type: 'qty-text', text: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'commit' }));
                        applyBillEditRows(billEditReducer(billEdit, { type: 'commit' }).rows);
                        setBillEditFocus(null);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'cancel' }));
                        setBillEditFocus(null);
                      }
                    }}
                    placeholder="Qty"
                    aria-label="Quantity"
                  />
                )}
                {billEditFocus === 'price' && (
                  <input
                    autoFocus
                    className="bsf-input"
                    style={{ width: 110 }}
                    value={billEdit.priceText}
                    onChange={(e) => setBillEdit((s) => billEditReducer(s, { type: 'price-text', text: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'commit' }));
                        applyBillEditRows(billEditReducer(billEdit, { type: 'commit' }).rows);
                        setBillEditFocus(null);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'cancel' }));
                        setBillEditFocus(null);
                      }
                    }}
                    placeholder="Price"
                    aria-label="Price"
                  />
                )}
                {billEditFocus === 'discount' && (
                  <input
                    autoFocus
                    className="bsf-input"
                    style={{ width: 110 }}
                    value={billEdit.discountText}
                    onChange={(e) => setBillEdit((s) => billEditReducer(s, { type: 'discount-text', text: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'commit' }));
                        applyBillEditRows(billEditReducer(billEdit, { type: 'commit' }).rows);
                        setBillEditFocus(null);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'cancel' }));
                        setBillEditFocus(null);
                      }
                    }}
                    placeholder="Discount"
                    aria-label="Line discount"
                  />
                )}
                {billEditFocus === 'note' && (
                  <input
                    autoFocus
                    className="bsf-input"
                    style={{ width: 200 }}
                    value={billEdit.noteText}
                    onChange={(e) => setBillEdit((s) => billEditReducer(s, { type: 'note-text', text: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'commit' }));
                        applyBillEditRows(billEditReducer(billEdit, { type: 'commit' }).rows);
                        setBillEditFocus(null);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setBillEdit((s) => billEditReducer(s, { type: 'cancel' }));
                        setBillEditFocus(null);
                      }
                    }}
                    placeholder="Note"
                    aria-label="Line note"
                  />
                )}
              </div>
            )}
            {items.map((it, idx) => {
              const promo = promoMap[it.product_id];
              const isScaleItem = it.scale_price != null;
              const unit = promo ? promo.effective_price : it.price;
              const units = it.units || [];
              const selectedUnit = units[it.selected_unit_level] || units[0];
              const multiplier = selectedUnit?.quantity_in_base_units || 1;

              let displayQty = 0;
              let displayPrice = 0;
              let availableLabel = '';

              if (isScaleItem) {
                // Scale items: show total decoded price, qty=1, no unit conversion
                displayPrice = it.scale_price ?? it.price;
                displayQty = 1;
                availableLabel = '—';
              } else {
                const rawDisplayQty = Math.round((it.qty / multiplier) * 1e9) / 1e9;
                displayQty = Math.round(rawDisplayQty * 1e6) / 1e6;
                displayPrice = Math.round(unit * multiplier * 100) / 100;
                const availableInUnit = it.stock_qty / multiplier;
                availableLabel =
                  multiplier < 1 ? String(Math.floor(availableInUnit)) : availableInUnit.toFixed(2).replace(/\.?0+$/, '');
              }

              const lineTaxable = unit * it.qty - it.line_discount;
              const lineTotal = lineTaxable + (lineTaxable * it.tax_rate) / 100;

              const handleQtyChange = (newQty: number) => {
                if (isScaleItem) return; // scale items: qty fixed at 1
                setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: newQty * multiplier } : x)));
              };

const handleUnitChange = (newLevel: number) => {
                  const units = it.units || [];
                  const newUnit = units[newLevel];
                  if (!newUnit) return;
                  // Base price per base unit (kilogram) – either from promotion or price mode fallback
                  const basePiece =
                    promo
                      ? promo.effective_price
                      : priceMode === 'wholesale' && it.wholesale_price != null
                        ? it.wholesale_price
                        : it.retail_price;
                  // Compute per‑selected‑unit price: if the unit has an explicit price, derive per‑unit price; otherwise reuse base price
                  const newPricePerUnit =
                    newUnit.price != null ? newUnit.price / newUnit.quantity_in_base_units : basePiece;
                  // Preserve the actual physical quantity (stored as base units) when switching units
                   // Preserve the base‑unit quantity (kg) when switching units; it.qty already stores the amount in base units
                  // Only the selected unit index and the per‑base‑unit price may need updating
                  setItems((prev) =>
                    prev.map((x, i) =>
                      i === idx
                        ? {
                            ...x,
                            selected_unit_level: newLevel,
                            // Keep the existing base‑unit quantity unchanged
                            qty: x.qty,
                            // Update price per base unit (kg) if the new unit defines an explicit price
                            price: newPricePerUnit,
                          }
                        : x
                    )
                  );
                };


              const draftKey = `${it.product_id}:${idx}`;
              const setDraft = (key: string, raw: string) => {
                if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
                  setInputDrafts((prev) => ({ ...prev, [key]: raw }));
                }
              };
              const commitDraft = (key: string): number | null => {
                const raw = inputDrafts[key];
                setInputDrafts((prev) => {
                  if (!(key in prev)) return prev;
                  const next = { ...prev };
                  delete next[key];
                  return next;
                });
                if (raw === undefined || raw === '') return null;
                const v = Number(raw);
                return Number.isFinite(v) ? v : null;
              };
              const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              };

              // --- Scale item 2-way sync (v1.8.6): weight <-> price via per-kg rate ---
              const scaleRatePerKg = it.retail_price; // per-kg rate captured at scan time
              const handleScaleWeightChange = (newWeightKg: number) => {
                const w = Math.round(newWeightKg * 1000) / 1000; // round to 3 decimals
                if (!Number.isFinite(w) || w <= 0 || !(scaleRatePerKg > 0)) return;
                const newPrice = Math.round(scaleRatePerKg * w * 100) / 100; // round to 2 decimals
                setItems((prev) =>
                  prev.map((x, i) =>
                    i === idx
                      ? { ...x, scale_weight_kg: w, scale_weight_g: Math.round(w * 1000), price: newPrice, scale_price: newPrice }
                      : x
                  )
                );
              };
              const handleScalePriceChange = (newPrice: number) => {
                const p = Math.round(newPrice * 100) / 100; // round to 2 decimals
                if (!Number.isFinite(p) || p <= 0 || !(scaleRatePerKg > 0)) return;
                const w = Math.round((p / scaleRatePerKg) * 1000) / 1000; // round to 3 decimals
                setItems((prev) =>
                  prev.map((x, i) =>
                    i === idx
                      ? { ...x, scale_price: p, price: p, scale_weight_kg: w, scale_weight_g: Math.round(w * 1000) }
                      : x
                  )
                );
              };

              return (
                <div
                  className={`cart-row${it.expired ? ' cart-row-expired' : ''}${cartSelIdx === idx ? ' cart-row-selected' : ''}${billEditMode && billEdit.selectedIndex === idx ? ' cart-row-billedit' : ''}`}
                  data-cart-idx={idx}
                  tabIndex={-1}
                  role={billEditMode ? 'option' : undefined}
                  aria-selected={billEditMode ? billEdit.selectedIndex === idx : undefined}
                  ref={(el) => (cartRowRefs.current[idx] = el)}
                  onFocus={() => setCartSelIdx(idx)}
                  key={`${it.product_id}-${idx}`}
                >
                  <div className="cart-info">
                    <strong>{it.name}</strong>
                    {it.scale_weight_g != null && (
                      <span className="badge badge-scale" title={`Scale label: PLU ${it.scale_plu}, Weight ${it.scale_weight_g}g`}>
                        ⚖ {it.scale_weight_g}g
                      </span>
                    )}
                    {it.expired && <span className="badge badge-danger">EXPIRED</span>}
                    {priceMode === 'wholesale' && it.wholesale_price != null && (
                      <span className="badge badge-quote">W</span>
                    )}
                    {!isScaleItem && (it.units && it.units.length > 1) && (
                      <select
                        className="unit-selector"
                        value={it.selected_unit_level}
                        onChange={(e) => handleUnitChange(Number(e.target.value))}
                        style={{ marginLeft: '4px', padding: '2px 4px', fontSize: '12px' }}
                      >
                        {it.units.map((u, i) => (
                          <option key={i} value={i}>
                            {u.quantity_in_base_units < 1 ? u.name : `${u.name} (${u.quantity_in_base_units}x)`}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="muted small">
                      {isScaleItem ? (
                        <>
                          <input
                            type="number"
                            className="line-price-input"
                            value={inputDrafts[`${draftKey}:price`] ?? String(displayPrice)}
                            min={0.01}
                            step={0.01}
                            disabled={!priceEditEnabled}
                            title="Total price — editing this recalculates weight"
                            onChange={(e) => setDraft(`${draftKey}:price`, e.target.value)}
                            onBlur={() => {
                              const v = commitDraft(`${draftKey}:price`);
                              if (v != null) handleScalePriceChange(v);
                            }}
                            onKeyDown={blurOnEnter}
                            style={{ width: '80px' }}
                          />
                          <span style={{ marginLeft: '4px' }}>× {scaleRatePerKg.toFixed(2)}/kg (scale)</span>
                        </>
                      ) : promo ? (
                        <>
                          <input
                            type="number"
                            className="line-price-input"
                            value={inputDrafts[`${draftKey}:price`] ?? String(displayPrice)}
                            disabled={!priceEditEnabled}
                            onBlur={() => {
                              const v = commitDraft(`${draftKey}:price`);
                              if (v != null && v >= 0) {
                                setItems((prev) =>
                                  prev.map((x, i) =>
                                    i === idx ? { ...x, price: v / multiplier } : x
                                  )
                                );
                              }
                            }}
                            onChange={(e) => setDraft(`${draftKey}:price`, e.target.value)}
                            onKeyDown={blurOnEnter}
                            style={{ width: '80px' }}
                          />
                          {(unit * multiplier).toFixed(2)} × {displayQty} {selectedUnit?.name || 'pcs'}
                        </>
                      ) : (
                        <>
                          <input
                            type="number"
                            className="line-price-input"
                            value={inputDrafts[`${draftKey}:price`] ?? String(displayPrice)}
                            disabled={!priceEditEnabled}
                            onBlur={() => {
                              const v = commitDraft(`${draftKey}:price`);
                              if (v != null && v >= 0) {
                                setItems((prev) =>
                                  prev.map((x, i) =>
                                    i === idx ? { ...x, price: v / multiplier } : x
                                  )
                                );
                              }
                            }}
                            onChange={(e) => setDraft(`${draftKey}:price`, e.target.value)}
                            onKeyDown={blurOnEnter}
                            style={{ width: '80px' }}
                          />
                          × {displayQty} {selectedUnit?.name || 'pcs'}
                        </>
                      )}
                      {it.tax_rate > 0 ? ` (tax ${it.tax_rate}%)` : ''}
                    </div>
                    {promo && <div className="small text-ok">Promo: {promo.promo_name}</div>}
                    {(() => {
                      if (it.stock_qty == null) return null;
                      const qtyToSell = isScaleItem ? (it.scale_weight_kg ?? 0) : it.qty;
                      const result = checkNegativeStock(it, qtyToSell, allowNegativeStock, maxNegativeQty);
                      if (result.allowed && result.warning === null) return null;
                      return (
                        <div className="small text-warn" style={{ background: '#fef3c7', padding: '2px 6px', borderRadius: 4, marginTop: 2, fontWeight: 600 }}>
                          {result.warning ?? `⚠ Cannot sell: would make stock negative`}
                        </div>
                      );
                    })()}
                    {it.stock_qty != null && it.stock_qty > 0 && !isScaleItem && it.qty > 0 && it.qty <= it.stock_qty && it.stock_qty <= 5 && (
                      <div className="small" style={{ color: 'var(--warn)', marginTop: 2 }}>
                        Low stock: {availableLabel} left
                      </div>
                    )}
                    {allowNegativeStock === 'no' && it.stock_qty != null && it.stock_qty <= 0 && (
                      <div className="small" style={{ color: 'var(--danger)', marginTop: 2, fontWeight: 600 }}>
                        ✕ Out of stock!
                      </div>
                    )}
                    <div className="small">
                      <span className="muted">Disc</span>{' '}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="line-price-input"
                        value={it.line_discount > 0 ? it.line_discount.toFixed(2) : ''}
                        placeholder="0.00"
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          const maxDisc = Math.max(0, unit * it.qty);
                          setItems((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? { ...x, line_discount: Math.min(v, maxDisc) }
                                : x
                            )
                          );
                        }}
                        style={{ width: '60px' }}
                      />
                    </div>
                    <div className="small" style={{ marginTop: 2 }}>
                      <input
                        type="text"
                        className="line-price-input"
                        value={it.note || ''}
                        placeholder="Note..."
                        maxLength={50}
                        onChange={(e) => {
                          setItems((prev) =>
                            prev.map((x, i) => i === idx ? { ...x, note: e.target.value } : x)
                          );
                        }}
                        style={{ width: '120px', fontSize: 11 }}
                        title="Item note (e.g. Gift wrap, Extra spice)"
                      />
                    </div>
                  </div>
                  <div className="cart-qty">
                    {isScaleItem ? (
                      <>
                        <button
                          className="btn btn-sm"
                          disabled={(it.scale_weight_kg ?? 0) <= 0.001}
                          onClick={() => handleScaleWeightChange((it.scale_weight_kg ?? 0) - 0.05)}
                          title="Reduce weight by 50g"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          className="qty-val"
                          min={0.001}
                          step={0.001}
                          value={inputDrafts[`${draftKey}:wt`] ?? String(it.scale_weight_kg ?? 0)}
                          title="Weight in kg — editing this recalculates price"
                          onChange={(e) => setDraft(`${draftKey}:wt`, e.target.value)}
                          onBlur={() => {
                            const v = commitDraft(`${draftKey}:wt`);
                            if (v != null) handleScaleWeightChange(v);
                          }}
                          onKeyDown={blurOnEnter}
                        />
                        <span className="muted small">kg</span>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleScaleWeightChange((it.scale_weight_kg ?? 0) + 0.05)}
                          title="Increase weight by 50g"
                        >
                          +
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => handleQtyChange(Math.max(1, displayQty - 1))}>
                          −
                        </button>
                        <input
                          type="number"
                          className="qty-val"
                          min={0.000001}
                          step="any"
                          value={inputDrafts[`${draftKey}:qty`] ?? String(displayQty)}
                          title={multiplier < 1 ? `Type quantity in ${selectedUnit?.name || 'grams'}` : 'Quantity'}
                          onChange={(e) => setDraft(`${draftKey}:qty`, e.target.value)}
                          onBlur={() => {
                            const v = commitDraft(`${draftKey}:qty`);
                            if (v != null && v > 0) handleQtyChange(Math.round(v * 1e6) / 1e6);
                          }}
                          onKeyDown={blurOnEnter}
                        />
                        <button className="btn btn-sm" onClick={() => handleQtyChange(displayQty + 1)}>
                          +
                        </button>
                      </>
                    )}
                  </div>
                  <div className="cart-line-total">{lineTotal.toFixed(2)}</div>
                  <button className="btn btn-sm btn-danger" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>
                    ×
                  </button>
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="muted center pad" style={{ padding: '24px 8px' }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35, marginBottom: 8 }}>
                  <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                </svg>
                <div>Bill is empty — search products or scan barcodes.</div>
              </div>
            )}
            </div>
        </div>
      </div>
      </div>

<div className="billen-billing-body">
        <div className="panel panel-summary">
          {items.some((i) => i.expired) && (
            <div className="expiry-warning-banner">
              <strong>Warning:</strong> This bill contains expired item(s):{' '}
              {items.filter((i) => i.expired).map((i) => i.name).join(', ')}. You will be asked to
              confirm before charging.
            </div>
          )}
          <div className="billten-summary-wrap">
            <div className="billten-summary-fields">
              <div className="bsf-grid">
                <label className="bsf-field">
                  <span className="bsf-label">Discount %</span>
                  <input
                    className={`bsf-input${summarySelIdx === 0 ? ' summary-field-selected' : ''}`}
                    data-summary-idx={0}
                    ref={(el) => (summaryFieldsRef.current[0] = el)}
                    type="number"
                    value={discountType === 'percent' ? billDiscount : ''}
                    placeholder="0"
                    onChange={(e) => { setBillDiscount(e.target.value); setDiscountType('percent'); setAutoAppliedDiscount(false); setDiscountRemoved(true); setDiscountSource('manual'); }}
                  />
                </label>
                <label className="bsf-field">
                  <span className="bsf-label">Discount Currency</span>
                  <input
                    className={`bsf-input${summarySelIdx === 1 ? ' summary-field-selected' : ''}`}
                    data-summary-idx={1}
                    ref={(el) => (summaryFieldsRef.current[1] = el)}
                    type="number"
                    value={discountType === 'amount' ? billDiscount : ''}
                    placeholder="0"
                    onChange={(e) => { setBillDiscount(e.target.value); setDiscountType('amount'); setAutoAppliedDiscount(false); setDiscountRemoved(true); setDiscountSource('manual'); }}
                  />
                </label>
                {customerDiscountBadgeText && (
                  <div className="bsf-field" style={{ gridColumn: '1 / -1' }}>
                    <span className="bsf-label">Customer discount</span>
                    <div className="bsf-input-group" style={{ alignItems: 'center', gap: '6px' }}>
                      <span className="badge" style={{ background: '#e8f5e9', color: '#0a7a33', border: '1px solid #a5d6a7', padding: '3px 8px', borderRadius: '4px', fontWeight: 700 }}>
                        {customerDiscountBadgeText}
                      </span>
                      <button type="button" className="btn btn-sm" onClick={removeCustomerDiscount} title="Remove the customer discount for this bill">
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                {customerDiscountHint && (
                  <div className="bsf-field" style={{ gridColumn: '1 / -1' }}>
                    <span className="muted" style={{ fontSize: '12px', color: '#8a5a00' }}>{customerDiscountHint}</span>
                  </div>
                )}
                <label className="bsf-field">
                  <span className="bsf-label">Tax</span>
                  <div className="bsf-input-group">
                  <input
                    className={`bsf-input${summarySelIdx === 2 ? ' summary-field-selected' : ''}`}
                    data-summary-idx={2}
                    ref={(el) => (summaryFieldsRef.current[2] = el)}
                    type="number"
                    value={serviceCharge}
                      placeholder="0"
                      onChange={(e) => setServiceCharge(e.target.value)}
                    />
                    <select className="bsf-select" value={serviceChargeType} onChange={(e) => setServiceChargeType(e.target.value as 'amount' | 'percent')}>
                      <option value="amount">{getCurrencySymbol()}</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                </label>
                <label className="bsf-field">
                  <span className="bsf-label">Payment Type</span>
                  <select className={`bsf-input bsf-select-full${summarySelIdx === 3 ? ' summary-field-selected' : ''}`} data-summary-idx={3} ref={(el) => (summaryFieldsRef.current[3] = el)} value={payModeQuick} onChange={(e) => setPayModeQuick(e.target.value)}>
                    {paymentModes.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="bsf-field">
                  <span className="bsf-label">Enter Remarks</span>
                  <input
                    className={`bsf-input${summarySelIdx === 4 ? ' summary-field-selected' : ''}`}
                    data-summary-idx={4}
                    ref={(el) => (summaryFieldsRef.current[4] = el)}
                    value={billRemarks}
                    placeholder="Note..."
                    onChange={(e) => setBillRemarks(e.target.value)}
                  />
                </label>
                <label className="bsf-field">
                  <span className="bsf-label">Enter Amount</span>
                  <input
                    className={`bsf-input${summarySelIdx === 5 ? ' summary-field-selected' : ''}`}
                    data-summary-idx={5}
                    ref={(el) => (summaryFieldsRef.current[5] = el)}
                    type="number"
                    value={quickAmount}
                    placeholder={finalTotal.toFixed(2)}
                    title="Pre-fills the paid amount when pressing Pay & Save"
                    onChange={(e) => setQuickAmount(e.target.value)}
                  />
                </label>
              </div>
              <div className="bsf-freight">
                <span className="bsf-label">Freight/Delivery</span>
                <div className="bsf-input-group">
                  <input
                    className={`bsf-input${summarySelIdx === 6 ? ' summary-field-selected' : ''}`}
                    data-summary-idx={6}
                    ref={(el) => (summaryFieldsRef.current[6] = el)}
                    type="number"
                    value={freight}
                    placeholder="0"
                    onChange={(e) => setFreight(e.target.value)}
                  />
                  <span className="bsf-unit">{getCurrencySymbol()}</span>
                </div>
              </div>
            </div>

            <div className="billten-summary-right">
              <div className="billten-summary-head">
                <span className="billten-summary-title">Bill Summary</span>
                {returnConfirmOpen && <span className="return-mode-badge">● Return Mode</span>}
                {receiptTemplates.length > 0 && (
                  <select
                    className="field-select billten-styles-select"
                    value={receiptTemplate}
                    onChange={(e) => applyReceiptTemplate(e.target.value)}
                    title="Receipt template"
                    aria-label="Receipt style"
                  >
                    {receiptTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="billten-summary-body">
                <div className="billten-cards-col">
                  <div className="bill-summary-grid">
                    <div className="bill-summary-item bill-sub-total">
                      <div className="bill-summary-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                      </div>
                      <span className="bill-summary-label">Sub Total</span>
                      <span className={`bill-summary-value${returnConfirmOpen ? ' return-negative' : ''}`}>
                        {returnConfirmOpen ? `-${totals.subtotal.toFixed(2)}` : totals.subtotal.toFixed(2)}
                      </span>
                    </div>
                    <div className="bill-summary-item bill-net-total">
                      <div className="bill-summary-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                      <span className="bill-summary-label">Net Total</span>
                      <span className={`bill-summary-value${returnConfirmOpen ? ' return-negative' : ''}`}>
                        {returnConfirmOpen ? `-${finalTotal.toFixed(2)}` : finalTotal.toFixed(2)}
                      </span>
                    </div>
                    <div className="bill-summary-item bill-paid">
                      <div className="bill-summary-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      </div>
                      <span className="bill-summary-label">Paid</span>
                      <span className="bill-summary-value">{payTotal.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="bill-summary-grid">
                    <div className="bill-summary-item bill-balance">
                      <div className="bill-summary-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      </div>
                      <span className="bill-summary-label">Balance</span>
                      <span className="bill-summary-value">{Math.max(0, finalTotal - payTotal).toFixed(2)}</span>
                    </div>
                    <div className="bill-summary-item bill-return">
                      <div className="bill-summary-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9 7 9-7"/><path d="M9 22V4"/></svg>
                      </div>
                      <span className="bill-summary-label">Return</span>
                      <span className={`bill-summary-value${returnConfirmOpen ? ' return-negative' : ''}`}>
                        {returnConfirmOpen ? returnTotal.toFixed(2) : '0'}
                      </span>
                    </div>
                    <div className="bill-summary-item bill-items">
                      <div className="bill-summary-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                      </div>
                      <span className="bill-summary-label">Total Item</span>
                      <span className="bill-summary-value">{items.reduce((s, c) => s + c.qty, 0)}</span>
                    </div>
                  </div>
                  <div className="billten-extra">
                    {roundOffEnabled && roundOffAmount !== 0 && (
                      <div className="billten-extra-row">
                        <span className="muted small">Round-off</span>
                        <span className="muted small">{roundOffAmount > 0 ? '+' : ''}{roundOffAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {profitLive && userRole === 'owner' && (
                      <div className="billten-extra-row">
                        <span className="small muted">Profit</span>
                        <span className="small" style={{ color: profitLive.margin > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 600 }}>
                          {formatMoney(profitLive.revenue - profitLive.cost)} ({profitLive.margin}%)
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="billten-actions-col">
                  <button className="action-btn-pay-save" onClick={quotationMode ? completeQuotation : openPay} disabled={items.length === 0 || busy || (!quotationMode && !shift)}>
                    {busy ? 'Working...' : quotationMode ? 'Save Quotation' : 'Pay & Save'}
                  </button>
                  <button className="action-btn-save" onClick={quotationMode ? completeQuotation : openPay} disabled={items.length === 0 || busy || (!quotationMode && !shift)}>
                    Save
                  </button>
                  <button className="action-btn-hold" onClick={doHold} disabled={items.length === 0}>
                    Hold
                  </button>
                  <button
                    className="action-btn-return"
                    onClick={openReturnFlow}
                    title={`Return / Refund — refund this cart in place, or load a past invoice (${resolveCombo('new_return', shortcutMap)})`}
                  >
                    Return / Refund
                  </button>
                  <button className="action-btn-reset" onClick={() => { setItems([]); setCustomerId(''); setBillDiscount(''); setAutoAppliedDiscount(false); setDiscountRemoved(false); setDiscountSource('none'); setDiscountType('amount'); setServiceCharge(''); setFreight(''); }}>
                    Reset
                  </button>
                </div>
              </div>
              <div className="shortcuts muted small" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span>{BILLING_HINTS.map((r) => `${resolveCombo(r.id, shortcutMap)} ${r.short}`).join(' · ')}</span>
                <button
                  className="btn btn-sm"
                  style={{ width: 18, height: 18, borderRadius: '50%', padding: 0, fontSize: 11, fontWeight: 700, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--muted-bg, #e5e7eb)', color: 'var(--muted, #6b7280)', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                  onClick={() => setShowShortcutsModal(true)}
                  title="Keyboard shortcuts"
                >?</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showShortcutsModal && (
        <Modal
          onClose={() => setShowShortcutsModal(false)}
          title="Keyboard Shortcuts"
          style={{ maxWidth: 420 }}
        >
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
                {BILLING_HINTS.map((r) => (
                  <div key={r.id} style={{ display: 'contents' }}>
                    <kbd style={{ fontWeight: 600, textAlign: 'right' }}>{resolveCombo(r.id, shortcutMap)}</kbd>
                    <span>{r.label}</span>
                  </div>
                ))}
                <kbd style={{ fontWeight: 600, textAlign: 'right' }}>Enter</kbd><span>Confirm payment / search</span>
                <kbd style={{ fontWeight: 600, textAlign: 'right' }}>Escape</kbd><span>Close modal / cancel</span>
              </div>
              {Object.keys(shortcutMap).length > 0 && (
                <>
                  <div style={{ marginTop: 12, marginBottom: 4, fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)' }}>Custom shortcuts</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
                    {Object.entries(shortcutMap).map(([action, key]) => (
                      <div key={action} style={{ display: 'contents' }}>
                        <kbd style={{ fontWeight: 600, textAlign: 'right' }}>{key.toUpperCase()}</kbd>
                        <span>{action.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
        </Modal>
      )}

      {expiredConfirm && (
        <Modal
          onClose={() => setExpiredConfirm(null)}
          title={<span className="text-warn">Expired Items in Bill</span>}
          className="modal-sm"
          closeOnOverlay={false}
        >
            <p>The following items have passed their expiry date. Selling expired stock is not recommended:</p>
            <ul className="expired-confirm-list">
              {expiredConfirm.map((i) => (
                <li key={i.product_id}>
                  <strong>{i.name}</strong> × {i.qty}
                </li>
              ))}
            </ul>
            <p className="muted small">Do you want to sell these expired items anyway?</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setExpiredConfirm(null)}>
                Go Back
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setExpiredConfirm(null);
                  setPayRows([{ mode: 'Cash', amount: grandTotal.toFixed(2) }]);
                  setPayOpen(true);
                }}
              >
                Sell Anyway
              </button>
            </div>
        </Modal>
      )}

      {payOpen && (
        <Modal
          onClose={() => setPayOpen(false)}
          title={`Payment — ${grandTotal.toFixed(2)}`}
          closeOnOverlay={false}
          onKeyDown={(e) => {
            // Legacy billing behavior: Enter from ANY field in the payment modal
            // completes the sale, rather than stepping through the fields.
            // stopPropagation keeps the window-level legacy handler from firing
            // completeSale a second time.
            if (
              (e.key === 'Enter' || e.key === '\r' || e.key === '\n') &&
              payTotal > 0 &&
              !busy
            ) {
              e.preventDefault();
              e.stopPropagation();
              completeSale();
            }
          }}
        >
            {payRows.map((r, idx) => (
              <div className="pay-row" key={idx}>
                <select
                  value={r.mode}
                  onChange={(e) =>
                    setPayRows((prev) => prev.map((x, i) => (i === idx ? { ...x, mode: e.target.value } : x)))
                  }
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="Udhaar">Udhaar (Credit)</option>
                </select>
                <KeyboardInput
                  type="text"
                  decimals
                  value={r.amount}
                  onChange={(e) =>
                    setPayRows((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))
                  }
                />
                <button
                  className="btn btn-sm btn-danger"
                  disabled={payRows.length === 1}
                  onClick={() => setPayRows((prev) => prev.filter((_, i) => i !== idx))}
                >
                  ×
                </button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setPayRows((prev) => [...prev, { mode: 'Cash', amount: '0' }])}>
              + Split Payment
            </button>
            {/* Quick denomination buttons */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span className="muted small" style={{ width: '100%', marginBottom: 2 }}>Quick cash:</span>
              {[100, 200, 500, 1000, 2000, 5000].map((denom) => (
                <button
                  key={denom}
                  className="btn btn-sm"
                  onClick={() => {
                    const remaining = Math.max(0, finalTotal - payRows.slice(0, -1).reduce((s, r) => s + (Number(r.amount) || 0), 0));
                    const amount = Math.min(denom, remaining);
                    setPayRows((prev) => {
                      const last = prev[prev.length - 1];
                      const rest = prev.slice(0, -1);
                      return [...rest, { ...last, amount: String(amount || denom) }];
                    });
                  }}
                  style={{ fontSize: 12 }}
                >
                  {getCurrencySymbol()} {denom}
                </button>
              ))}
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  const remaining = Math.max(0, finalTotal - payRows.slice(0, -1).reduce((s, r) => s + (Number(r.amount) || 0), 0));
                  setPayRows((prev) => {
                    const last = prev[prev.length - 1];
                    const rest = prev.slice(0, -1);
                    return [...rest, { ...last, amount: String(remaining) }];
                  });
                }}
                style={{ fontSize: 12 }}
              >
                Exact
              </button>
            </div>
            <div style={{ marginTop: 8 }}>
              <span className={`muted small ${payTotal >= finalTotal ? 'text-ok' : 'text-warn'}`}>
                Paid: {payTotal.toFixed(2)} / {finalTotal.toFixed(2)}
                {payTotal > finalTotal ? ` (change: ${(payTotal - finalTotal).toFixed(2)})` : payTotal < finalTotal ? ` (due: ${(finalTotal - payTotal).toFixed(2)})` : ''}
              </span>
            </div>
            <div className="pay-info muted small">
              Total: {payTotal.toFixed(2)} {payTotal < grandTotal && !customerId && <b className="text-warn">(customer required for balance)</b>}
            </div>
            {payTotal > grandTotal && (
              <div className="small text-ok">Change: {(payTotal - grandTotal).toFixed(2)}</div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setPayOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={completeSale} disabled={busy || payTotal <= 0}>
                Complete Sale
              </button>
            </div>
        </Modal>
      )}

      {success && (
        <Modal
          onClose={() => setSuccess(null)}
          title={<span className="text-ok">Sale Completed</span>}
          className="modal-sm"
          closeOnOverlay={false}
        >
            <p>
              <strong>Invoice:</strong> {success.sale.invoice_no}
            </p>
            <p>
              <strong>Total:</strong> {success.sale.total_amount.toFixed(2)}
            </p>
            {success.change > 0 && (
              <p>
                <strong>Change:</strong> {success.change.toFixed(2)}
              </p>
            )}
            {success.balance > 0 && (
              <p className="text-warn">
                <strong>Udhaar balance:</strong> {success.balance.toFixed(2)}
              </p>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setSuccess(null)}>
                Close
              </button>
              {receiptTemplates.length > 1 && (
                <select
                  className="field-select"
                  value={receiptTemplate}
                  onChange={(e) => applyReceiptTemplate(e.target.value)}
                  style={{ fontSize: 12 }}
                  title="Receipt template"
                >
                  {receiptTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
                <button
                  className="btn"
                  onClick={() => {
                    window.api.printing
                      .previewReceipt(success.sale.id, receiptTemplate)
                      .then((r) => { if (r && r.ok === false) setNotice(r.message); })
                      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  Preview Receipt
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    window.api.printing.printSale(success.sale.id, receiptTemplate)
                      .then((r) => { if (r && r.ok === false) setNotice(r.message); })
                      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  Print Receipt
                </button>
                <button
                  className="btn"
                  title="Print the last completed sale again, stamped DUPLICATE COPY"
                  onClick={() => {
                    window.api.printing.reprintLastReceipt()
                      .then((r) => { if (r && r.ok === false) setNotice(r.message); })
                      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  Reprint Last
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    window.api.printing
                      .previewInvoice(success.sale.id)
                      .then((r) => { if (r && r.ok === false) setNotice(r.message); })
                      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  Preview Invoice
                </button>
                <button
                  className="btn btn-primary"
                  ref={printInvoiceBtnRef}
                  onClick={handlePrintInvoice}
                >
                  Print Invoice
                </button>
                {(() => {
                  const cust = customers.find((c) => String(c.id) === customerId);
                  if (!cust?.phone) return null;
                  return (
                    <button
                      className="btn"
                      title={`Send receipt to ${cust.name} (${cust.phone}) on WhatsApp`}
                      onClick={async () => {
                        try {
                          const r = await window.api.whatsapp.sendSaleReceipt(success.sale.id, cust.phone ?? undefined);
                          setNotice(r.message);
                        } catch (e) {
                          setNotice(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      WhatsApp Receipt
                    </button>
                  );
                })()}
                <div className="modal-action-row">
                  <input
                    type="email"
                    placeholder="Customer email"
                    value={emailToSend}
                    onChange={e => setEmailToSend(e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
                  />
                  <button className="btn btn-sm" onClick={async () => {
                    if (!emailToSend || !success?.sale?.id) return;
                    const res = await window.api.receipt.sendEmail(success.sale.id, emailToSend);
                    alert(res.message);
                  }}>Email</button>
                </div>
                <div className="modal-action-row">
                  <input
                    type="tel"
                    placeholder="Customer phone"
                    value={smsToSend}
                    onChange={e => setSmsToSend(e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
                  />
                  <button className="btn btn-sm" onClick={async () => {
                    if (!smsToSend || !success?.sale?.id) return;
                    const res = await window.api.receipt.sendSms(success.sale.id, smsToSend);
                    alert(res.message);
                  }}>SMS</button>
                </div>
              <button className="btn btn-primary" onClick={newBill}>
                New Bill
              </button>
            </div>
        </Modal>
      )}

      {qtyDialog && (
        <Modal
          onClose={() => setQtyDialog(null)}
          onSubmit={confirmQtyDialog}
          title={`Quantity — ${qtyDialog.product.name}`}
          className="modal-sm"
          closeOnOverlay={false}
        >
            <label className="field">
              <span>Quantity (Enter ↑ / ↓ for quick adjust)</span>
              <KeyboardInput
                type="text"
                decimals={false}
                autoFocus
                value={qtyDialogValue}
                onChange={(e) => setQtyDialogValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
                    e.preventDefault();
                    confirmQtyDialog();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setQtyDialogValue((v) => String((parseInt(v, 10) || 1) + 1));
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setQtyDialogValue((v) => String(Math.max(1, (parseInt(v, 10) || 1) - 1)));
                  } else if (e.key === 'Escape') {
                    setQtyDialog(null);
                  }
                }}
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setQtyDialog(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirmQtyDialog}>
                Add {qtyDialogValue || '1'}
              </button>
            </div>
        </Modal>
      )}

      {custModal && (
        <Modal
          onClose={() => setCustModal(false)}
          title="New Customer"
          className="modal-sm"
          closeOnOverlay={false}
        >
            <label className="field">
              <span>Name *</span>
              <input value={newCustName} onChange={(e) => setNewCustName(e.target.value)} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} />
            </label>
            <label className="field">
              <span>Opening Balance ({getCurrencySymbol()})</span>
              <KeyboardInput
                type="text"
                decimals
                value={newCustBalance}
                onChange={(e) => setNewCustBalance(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setCustModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!newCustName.trim()}
                onClick={async () => {
                  const c = await window.api.customers.create(newCustName, newCustPhone, Number(newCustBalance) || 0);
                  setCustomers(await window.api.customers.list());
                  setCustomerId(String(c.id));
                  setCustModal(false);
                  setNewCustName('');
                  setNewCustPhone('');
                  setNewCustBalance('');
                }}
              >
                Save
              </button>
            </div>
        </Modal>
      )}

      {returnFindOpen && (
        <Modal
          onClose={() => setReturnFindOpen(false)}
          title="Return / Refund — Find Invoice"
          style={{ maxWidth: 620 }}
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            The cart is empty, so there is nothing to refund yet. Type an invoice number or
            customer name to load a past sale's items as return lines (or scan a product
            barcode to add it), then confirm the refund.
          </p>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              className="return-find-input"
              placeholder="Invoice no., customer, or barcode…"
              value={returnFind}
              onChange={(e) => setReturnFind(e.target.value)}
              autoFocus
              onKeyDown={async (e) => {
                if (e.key !== 'Enter' || !returnFind.trim()) return;
                e.preventDefault();
                const q = returnFind.trim();
                const exact = returnFindMatches.find(
                  (s) => (s.invoice_no ?? '').toLowerCase() === q.toLowerCase()
                );
                if (exact) return loadReturnInvoice(exact.id);
                if (returnFindMatches.length === 1) return loadReturnInvoice(returnFindMatches[0].id);
                if (returnFindMatches.length === 0 && q.length >= 4) {
                  try {
                    const p = await window.api.inventory.getByBarcode(q);
                    if (p) {
                      addProduct(p);
                      setReturnLinkedInvoice('');
                      setReturnFindOpen(false);
                      setReturnConfirmOpen(true);
                      setNotice(`Added ${p.name} to the return`);
                    } else {
                      setNotice('No invoice or product matched that code');
                    }
                  } catch (err) {
                    setNotice(err instanceof Error ? err.message : String(err));
                  }
                }
              }}
            />
          </div>
          {returnFindBusy ? (
            <div className="muted center pad">Loading recent sales…</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {returnFindMatches.map((s) => (
                    <tr key={s.id}>
                      <td>{s.invoice_no}</td>
                      <td>{s.created_at ? formatDateTimeAdmin(s.created_at) : '—'}</td>
                      <td>{s.customer_name ?? 'Walk-in'}</td>
                      <td>{formatMoney(s.total_amount)}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => loadReturnInvoice(s.id)}
                        >
                          Load items
                        </button>
                      </td>
                    </tr>
                  ))}
                  {returnFindMatches.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted center pad">
                        No matching sales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {returnConfirmOpen && (
        <Modal
          onClose={() => {
            if (!returnBusy) setReturnConfirmOpen(false);
          }}
          title="Confirm Return / Refund"
          closeOnOverlay={false}
          style={{ maxWidth: 560 }}
          initialFocusRef={returnConfirmBtnRef}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
              e.preventDefault();
              e.stopPropagation();
              void confirmReturn();
            }
          }}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setReturnConfirmOpen(false)}
                disabled={returnBusy}
              >
                Cancel
              </button>
              <button
                ref={returnConfirmBtnRef}
                type="button"
                className="btn btn-primary"
                onClick={() => void confirmReturn()}
                disabled={returnBusy || items.length === 0}
              >
                {returnBusy ? 'Saving…' : 'Confirm Return'}
              </button>
            </>
          }
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            This will refund the items below, put them back in stock and take the money out
            of the cash drawer. The bill is saved as a return and the cart is cleared.
          </p>
          {!shift && (
            <div className="notice" style={{ marginBottom: 8 }}>
              No shift is open for this cash drawer — open a shift before refunding.
            </div>
          )}
          <div className="return-modal-items">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'right' }}>Refund</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={`${it.product_id}-${idx}`}>
                    <td>{it.name}</td>
                    <td style={{ textAlign: 'right' }}>{formatStockQty(it.qty)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.price).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {(Number(it.qty) * Number(it.price)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="return-refund-total">
            <span>Total refund</span>
            <span>{formatMoney(returnTotal)}</span>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 200px' }}>
              <span className="field-label">Refund method</span>
              <select
                className="field-select"
                value={returnRefundMode}
                onChange={(e) => setReturnRefundMode(e.target.value)}
              >
                {RETURN_REFUND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '1 1 200px' }}>
              <span className="field-label">Reason</span>
              <select
                className="field-select"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
              >
                {RETURN_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field" style={{ marginTop: 8 }}>
            <span className="field-label">Note (optional)</span>
            <textarea
              className="return-note-input"
              rows={2}
              value={returnNote}
              placeholder="Anything to remember about this refund"
              onChange={(e) => setReturnNote(e.target.value)}
            />
          </label>
          <div className="muted small" style={{ marginTop: 8, display: 'grid', gap: 2 }}>
            <div>
              <strong>Customer:</strong>{' '}
              {customerId
                ? customers.find((c) => String(c.id) === customerId)?.name ?? `#${customerId}`
                : 'Walk-in'}
              {returnRefundMode === 'credit' && !customerId && (
                <span className="text-warn"> — select a customer to refund to credit</span>
              )}
            </div>
            {returnLinkedInvoice && (
              <div>
                <strong>Original invoice:</strong> {returnLinkedInvoice}
              </div>
            )}
          </div>
        </Modal>
      )}

      {quickCustomerOpen && (
        <QuickCustomerDialog
          existing={customers}
          initialName={quickCustomerSeed}
          onClose={() => setQuickCustomerOpen(false)}
          onOpenFullForm={(draft) => {
            setQuickCustomerOpen(false);
            setFullCustomerSeed({
              name: draft.name,
              phone: draft.phone ?? '',
              customer_type: draft.customer_type,
              default_discount_pct: draft.discount_value,
              discount_type: draft.discount_type,
              discount_min_bill: draft.discount_min_bill,
              price_level: draft.price_level,
              credit_limit: draft.credit_limit,
              credit_days: draft.credit_days,
              opening_balance: draft.opening_balance,
              notes: draft.notes ?? '',
            });
            setFullCustomerOpen(true);
          }}
          onCreated={(c) => {
            setCustomerId(String(c.id));
            setCustomers((prev) => [...prev, c]);
            setNotice(`Customer "${c.name}" added`);
          }}
        />
      )}

      {fullCustomerOpen && (
        <UdhaarCustomerModal
          initial={fullCustomerSeed}
          onClose={() => setFullCustomerOpen(false)}
          onSaved={(c) => {
            setFullCustomerOpen(false);
            setFullCustomerSeed({});
            setCustomers((prev) => [...prev, c]);
            setCustomerId(String(c.id));
            setNotice(`Customer "${c.name}" added`);
          }}
        />
      )}

      {heldModal && (
        <Modal
          onClose={() => setHeldModal(null)}
          title={heldModal.tab === 'held' ? 'Held Bills' : 'Quotations'}
          closeOnOverlay={false}
          className="modal-wide"
        >
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Customer</th>
                    <th style={{ textAlign: 'right' }}>Items</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Saved</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {heldModal.rows.map((h) => {
                    // One corrupt payload must not blank the whole list.
                    let s: HeldBillSummary;
                    try { s = summarizeHeldBill(JSON.parse(h.data)); }
                    catch { s = summarizeHeldBill(null); }
                    const cust = s.customerId ? customers.find((c) => String(c.id) === s.customerId) : null;
                    const label = h.label || (s.lineCount ? `${s.lineCount} item${s.lineCount === 1 ? '' : 's'}` : 'Bill');
                    return (
                      <tr key={h.id}>
                        <td>#{h.id} · {label}</td>
                        <td>{cust ? cust.name : 'Walk-in'}</td>
                        <td style={{ textAlign: 'right' }}>{s.lineCount}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(s.total)}</td>
                        <td>{h.created_at ? formatDateTimeAdmin(h.created_at) : '—'}</td>
                        <td>
                          <div className="row-actions">
                            <button className="btn btn-sm" onClick={() => resumeHeld(h)}>
                              {heldModal.tab === 'held' ? 'Resume' : 'Load'}
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => {
                                setHoldDeleteReason('');
                                setHoldDeleteTarget(h);
                              }}
                            >
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {heldModal.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted center">
                        Nothing {heldModal.tab === 'held' ? 'held' : 'quoted'} yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setHeldModal(null)}>
                Close
              </button>
            </div>
        </Modal>
      )}

      {history && (
        <Modal
          onClose={() => setHistory(null)}
          title="Sales History — Today's Timeline"
          className="modal-wide"
          closeOnOverlay={false}
        >
            {historyOpenHolds > 0 && (
              <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: '#fff7e6', border: '1px solid #ffd591', color: '#8a5a00' }}>
                <strong>{historyOpenHolds}</strong> bill{historyOpenHolds === 1 ? '' : 's'} currently on hold — they are not sales yet.
              </div>
            )}

            {/* Summary strip — must equal Dashboard Today + Returns for the same range. */}
            {historySummary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                {[
                  { label: 'Sales', value: `${historySummary.salesCount}`, sub: formatMoney(historySummary.salesTotal), tone: '#0a7a33' },
                  { label: 'Returns / Refunds', value: `${historySummary.returnsCount + historySummary.cashRefundsCount}`, sub: formatMoney(-(historySummary.returnsTotal + historySummary.cashRefundsTotal)), tone: '#b42318' },
                  { label: 'Voids', value: `${historySummary.voidsCount}`, sub: formatMoney(-historySummary.voidsTotal), tone: '#b42318' },
                  { label: 'Deletes', value: `${historySummary.deletesCount}`, sub: formatMoney(-historySummary.deletesTotal), tone: '#b42318' },
                  { label: 'Holds', value: `${historySummary.holdCreatedCount}/${historySummary.holdResumedCount}/${historySummary.holdDeletedCount}`, sub: 'held / resumed / deleted', tone: '#8a5a00' },
                  { label: 'NET SALES', value: formatMoney(historySummary.netSales), sub: 'after returns + refunds', tone: '#0b3d91' },
                  { label: 'Cash / Non-cash', value: formatMoney(historySummary.cashTotal), sub: formatMoney(historySummary.nonCashTotal), tone: '#333' },
                  { label: 'Cancelled value', value: formatMoney(historySummary.cancelledValue), sub: 'voids + deleted bills', tone: '#b42318' },
                ].map((card) => (
                  <div key={card.label} style={{ padding: '8px 10px', borderRadius: '6px', background: '#f8f9fa', border: '1px solid #e0e0e0' }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.4px', color: '#666' }}>{card.label}</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: card.tone }}>{card.value}</div>
                    <div style={{ fontSize: '11px', color: '#666' }}>{card.sub}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Multi-select type chips. Every type is on by default; nothing is hidden. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              <button
                type="button"
                className={`btn btn-sm ${historyFilters.types.length >= HISTORY_EVENT_TYPES.length ? 'btn-primary' : ''}`}
                onClick={() => {
                  const next = { ...historyFilters, types: [...HISTORY_EVENT_TYPES] };
                  setHistoryFilters(next);
                  void loadHistory(next, 1);
                }}
              >
                All events
              </button>
              {HISTORY_EVENT_TYPES.map((type) => {
                const selected = historyFilters.types.includes(type);
                const count = historyCounts.find((c) => c.event_type === type)?.count ?? 0;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`btn btn-sm ${HISTORY_EVENT_CLASSES[type]}`}
                    onClick={() => toggleHistoryType(type)}
                    style={{
                      opacity: selected ? 1 : 0.45,
                      border: selected ? '2px solid #0b3d91' : '1px solid #ccc',
                      fontWeight: selected ? 700 : 400,
                    }}
                    title={`${HISTORY_EVENT_LABELS[type]} — ${count} in this range`}
                  >
                    {HISTORY_EVENT_LABELS[type]} <span style={{ opacity: 0.7 }}>({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
              <select className="field-select" value={datePreset} onChange={(e) => applyDatePreset(e.target.value as typeof datePreset)} style={{ width: '130px' }}>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="lastmonth">Last Month</option>
                <option value="custom">Custom</option>
              </select>
              <DateInput value={historyFilters.from} onChange={(v) => { setHistoryFilters(f => ({ ...f, from: v })); setDatePreset('custom'); }} title="From Date" style={{ width: '135px' }} />
              <span className="muted">to</span>
              <DateInput value={historyFilters.to} onChange={(v) => { setHistoryFilters(f => ({ ...f, to: v })); setDatePreset('custom'); }} title="To Date" style={{ width: '135px' }} />
              <input type="text" value={historyFilters.search} onChange={(e) => setHistoryFilters(f => ({ ...f, search: e.target.value }))} placeholder="Invoice / customer / reason..." style={{ width: '210px' }} />
              <input type="text" value={historyFilters.customer} onChange={(e) => setHistoryFilters(f => ({ ...f, customer: e.target.value }))} placeholder="Customer..." style={{ width: '150px' }} />
              <select className="field-select" value={historyFilters.userId} onChange={(e) => setHistoryFilters(f => ({ ...f, userId: e.target.value }))} style={{ width: '170px' }}>
                <option value="">Done by: anyone</option>
                {cashiers.map(u => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
              </select>
              <select className="field-select" value={historyFilters.paymentMode} onChange={(e) => setHistoryFilters(f => ({ ...f, paymentMode: e.target.value }))} style={{ width: '140px' }}>
                <option value="">All payments</option>
                {paymentModes.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input type="text" value={historyFilters.product} onChange={(e) => setHistoryFilters(f => ({ ...f, product: e.target.value }))} placeholder="Product..." style={{ width: '150px' }} />
              <KeyboardInput type="text" decimals value={historyFilters.minAmount} onChange={(e) => setHistoryFilters(f => ({ ...f, minAmount: e.target.value }))} placeholder="Min amount" style={{ width: '105px' }} />
              <KeyboardInput type="text" decimals value={historyFilters.maxAmount} onChange={(e) => setHistoryFilters(f => ({ ...f, maxAmount: e.target.value }))} placeholder="Max amount" style={{ width: '105px' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#333' }}>
                <input type="checkbox" checked={historyFilters.onlyMySales} onChange={(e) => setHistoryFilters(f => ({ ...f, onlyMySales: e.target.checked }))} />
                Only mine
              </label>
              <button className="btn btn-primary btn-sm" onClick={() => void applyHistoryFilters(1)} disabled={historyBusy}>Apply</button>
              <button className="btn btn-sm" onClick={clearHistoryFilters}>Clear Filters</button>
              <button className="btn btn-sm" onClick={() => void loadHistory(historyFilters, historyPage)} disabled={historyBusy}>Refresh</button>
              <button className="btn btn-sm" onClick={() => void exportHistoryCsv()} disabled={!history.length}>CSV</button>
              <button className="btn btn-sm" onClick={() => void exportHistoryExcel()} disabled={!history.length}>Excel</button>
              <button className="btn btn-sm" onClick={() => void window.api.history.print(historyUiToService(historyFilters))} disabled={!history.length}>Print</button>
            </div>

            <div className="table-wrap" style={{ overflow: 'auto', maxHeight: '58vh' }}>
              <table className="data-table" style={{ minWidth: '1150px' }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Cashier</th>
                    <th>Payment</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Reason</th>
                    <th>Reference</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((e) => {
                    const isVoidOrDelete = e.event_type === 'void' || e.event_type === 'delete' || e.event_type === 'hold_deleted';
                    const negative = e.amount < 0;
                    return (
                      <tr key={e.event_id} onClick={() => void openHistoryDetail(e.event_id)} style={{ cursor: 'pointer' }}>
                        <td title={formatDateTimeAdmin(e.occurred_at)}>
                          <div>{formatTimeAdmin(e.occurred_at)}</div>
                          <div className="muted" style={{ fontSize: '11px' }}>{e.local_day}</div>
                        </td>
                        <td><span className={`badge ${HISTORY_EVENT_CLASSES[e.event_type]}`}>{HISTORY_EVENT_LABELS[e.event_type]}</span></td>
                        <td>{e.invoice_no ?? '—'}</td>
                        <td>{e.customer ?? 'Walk-in'}</td>
                        <td>{e.user ?? 'System'}</td>
                        <td>{e.payment_mode ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: negative ? '#b42318' : '#0a7a33', textDecoration: isVoidOrDelete ? 'line-through' : 'none' }}>
                          {negative ? '-' : ''}{formatMoney(Math.abs(e.amount))}
                        </td>
                        <td title={e.reason ?? ''}>{e.reason ?? '—'}</td>
                        <td>{e.reference_invoice ?? '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); void openHistoryDetail(e.event_id); }}>View</button>
                            {e.event_type === 'sale' && e.sale_id && e.status === 'completed' && (
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={(ev) => { ev.stopPropagation(); void voidFromHistory(e); }}
                              >
                                Void
                              </button>
                            )}
                            {e.event_type === 'hold_created' && e.held_bill_id && (
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setHoldDeleteReason('');
                                  setHoldDeleteTarget({ id: e.held_bill_id as number, kind: 'held', label: e.invoice_no, data: '{}' });
                                }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={10} className="muted center" style={{ padding: '24px' }}>
                        {historyBusy ? 'Loading…' : 'No activity today yet.'}
                        {!historyBusy && (
                          <div style={{ marginTop: '8px' }}>
                            <button
                              className="btn btn-sm"
                              onClick={() => {
                                const now = new Date();
                                const from = toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
                                const to = toLocalDateString(now);
                                const next = { ...historyFilters, from, to };
                                setHistoryFilters(next);
                                setDatePreset('month');
                                void loadHistory(next, 1);
                              }}
                            >
                              Show this month
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: '12px' }}>
                {historyBusy ? 'Loading…' : `${history.length} of ${historyTotal} event${historyTotal === 1 ? '' : 's'} · newest first. Press Esc to close, Refresh to reload. Totals count a sale only while it is not voided; voids are listed on the day they happen.`}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn btn-sm" disabled={historyPage <= 1 || historyBusy} onClick={() => void applyHistoryFilters(historyPage - 1)}>Previous</button>
                <button className="btn btn-sm" disabled={historyPage * 50 >= historyTotal || historyBusy} onClick={() => void applyHistoryFilters(historyPage + 1)}>Next</button>
                <button className="btn" onClick={() => setHistory(null)}>Close</button>
              </div>
            </div>
        </Modal>
      )}

      {historyDetail && (
        <Modal
          onClose={() => setHistoryDetail(null)}
          title={`${HISTORY_EVENT_LABELS[historyDetail.event.event_type]} — ${historyDetail.event.invoice_no ?? 'Event #' + historyDetail.event.event_id}`}
          className="modal-wide"
          closeOnOverlay={false}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '12px' }}>
            <div><strong>Time:</strong> {formatDateTimeAdmin(historyDetail.event.occurred_at)}</div>
            <div><strong>Done by:</strong> {historyDetail.event.user ?? 'System'}</div>
            <div><strong>Amount:</strong> {formatMoney(historyDetail.event.amount)}</div>
            <div><strong>Payment:</strong> {historyDetail.event.payment_mode ?? '—'}</div>
            <div><strong>Reason:</strong> {historyDetail.event.reason ?? '—'}</div>
            <div><strong>Reference:</strong> {historyDetail.event.reference_invoice ?? '-'}</div>
          </div>
          {historyDetailSnapshotDiscount && (
            <div style={{ marginBottom: '12px' }}>
              <strong>{historyDetailSnapshotDiscount}</strong>
            </div>
          )}
          {historyDetail.items.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: '40vh', overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Product</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Discount</th><th style={{ textAlign: 'right' }}>Line total</th></tr>
                </thead>
                <tbody>
                  {historyDetail.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.product_name}</td>
                      <td style={{ textAlign: 'right' }}>{it.qty}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(it.unit_price)}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(it.discount ?? 0)}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {historyDetail.snapshot != null && (
            <details style={{ marginTop: '12px' }}>
              <summary style={{ cursor: 'pointer' }}>Snapshot (state at the time of this event)</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px', maxHeight: '30vh', overflow: 'auto', background: '#f6f6f6', padding: '8px' }}>
                {JSON.stringify(historyDetail.snapshot, null, 2)}
              </pre>
            </details>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={() => setHistoryDetail(null)}>Close</button>
          </div>
        </Modal>
      )}

      {holdDeleteTarget && (
        <Modal
          onClose={() => setHoldDeleteTarget(null)}
          title="Delete held bill — reason required"
          className="modal-sm"
          closeOnOverlay={false}
        >
          <p className="muted">The bill stays visible in Sales History with this reason. Stock was never moved.</p>
          <label className="field">
            <span>Reason</span>
            <input
              autoFocus
              value={holdDeleteReason}
              onChange={(e) => setHoldDeleteReason(e.target.value)}
              placeholder="e.g. customer left / duplicate hold"
            />
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setHoldDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={!holdDeleteReason.trim()} onClick={() => void confirmDeleteHeld()}>Delete</button>
          </div>
        </Modal>
      )}
      {/* Below cost confirmation modal */}
      {belowCostConfirm && (
        <Modal
          onClose={() => setBelowCostConfirm(null)}
          title={<span className="text-warn">Below-Cost Items</span>}
          className="modal-sm"
          showClose={false}
          closeOnOverlay={false}
        >
            <p>The following items are priced below cost. Selling them requires manager approval.</p>
            <ul className="expired-confirm-list">
              {belowCostConfirm.map((i) => (
                <li key={i.product_id}>
                  {i.scale_price != null && i.scale_weight_kg != null && i.scale_weight_kg > 0 ? (
                    <>
                      <strong>{i.name}</strong> — {i.scale_weight_g}g (price {i.price.toFixed(2)} &lt; cost{' '}
                      {(i.cost_price * i.scale_weight_kg).toFixed(2)})
                    </>
                  ) : (
                    <>
                      <strong>{i.name}</strong> × {i.qty} (price {i.price} &lt; cost {i.cost_price})
                    </>
                  )}
                </li>
              ))}
            </ul>
            <label className="field">
              <span>Manager</span>
              <select value={priceFloorUserId ?? ''} onChange={(e) => setPriceFloorUserId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Select manager</option>
                {managerUsers.filter((u) => u.role === 'owner' || u.role === 'manager').map((u) => (
                  <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>PIN / Password</span>
              <input type="password" value={priceFloorPin} onChange={(e) => setPriceFloorPin(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => { setBelowCostConfirm(null); setPriceFloorPin(''); setPriceFloorUserId(null); }}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={!priceFloorUserId || !priceFloorPin}
                onClick={async () => {
                  if (!priceFloorUserId) { setNotice('Select manager'); return; }
                  const ok = await window.api.auth.verifyForUser(priceFloorUserId, priceFloorPin);
                  if (!ok) { setNotice('Invalid credentials'); return; }
                  setPriceFloorOverride(true);
                  setBelowCostConfirm(null);
                  setPriceFloorPin('');
                  setPriceFloorUserId(null);
                  setPayRows([{ mode: 'Cash', amount: grandTotal.toFixed(2) }]);
                  setPayOpen(true);
                }}
              >
                Override &amp; Continue
              </button>
            </div>
        </Modal>
      )}
        {saleDetail && (
        <Modal
          onClose={() => setSaleDetail(null)}
          title={`Sale Detail — ${saleDetail.invoice_no}`}
          className="modal-wide"
          closeOnOverlay={false}
        >
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={handleConvertToReturn}>Convert to Return</button>
              <button className="btn btn-secondary" onClick={() => {
                window.api.printing.printSale(saleDetail.id, undefined, { duplicate: true })
                  .then((r) => { if (r && r.ok === false) setNotice(r.message); })
                  .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
              }}>Reprint Receipt</button>
              <button className="btn btn-primary" onClick={handleDuplicateAsNewSale}>Duplicate as New Sale</button>
              <button className="btn" onClick={() => setSaleDetail(null)}>Close</button>
            </div>
            
            {/* Header Info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '4px' }}>
              <div><strong>Date:</strong> {saleDetail.created_at ? formatDateTimeAdmin(saleDetail.created_at) : '—'}</div>
              <div><strong>Customer:</strong> {saleDetail.customer_name ?? 'Walk-in'}</div>
              <div><strong>Cashier:</strong> {saleDetail.cashier_name ?? '—'}</div>
              <div><strong>Status:</strong> <span className={`badge ${saleDetail.status === 'voided' ? 'badge-danger' : ''}`}>{saleDetail.status}</span></div>
            </div>

            {/* Items Table */}
            <div className="table-wrap" style={{ maxHeight: '400px', overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Discount</th>
                    <th>Tax %</th>
                    <th>Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {saleDetail.items.map((item, i) => (
                    <tr key={i}>
                      <td>{item.product_name ?? `Product #${item.product_id}`}</td>
                      <td>{item.display_qty != null ? `${item.display_qty} ${item.unit_name ?? ''}` : item.qty}</td>
                      <td>{item.unit_price.toFixed(2)}</td>
                      <td>{item.discount.toFixed(2)}</td>
                      <td>{item.tax_rate.toFixed(2)}%</td>
                      <td>{item.line_total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '4px' }}>
              <div><strong>Subtotal:</strong> {saleDetail.subtotal.toFixed(2)}</div>
              <div><strong>Discount:</strong> {saleDetail.discount_amount.toFixed(2)}</div>
              {saleDetailDiscountLabel && (
                <div><strong>{saleDetailDiscountLabel}</strong></div>
              )}
              <div><strong>Service Charge:</strong> {(saleDetail.service_charge || 0).toFixed(2)}</div>
              <div><strong>Tax:</strong> {saleDetail.tax_amount.toFixed(2)}</div>
              <div><strong>Freight:</strong> {(saleDetail.freight || 0).toFixed(2)}</div>
              <div style={{ fontWeight: 'bold', fontSize: '1.1em' }}><strong>Total:</strong> {saleDetail.total_amount.toFixed(2)}</div>
            </div>

            {/* Payment Breakdown */}
            <div style={{ marginTop: '12px', padding: '12px', background: '#f0f4f8', borderRadius: '4px' }}>
              <strong>Payments:</strong>
              {Object.entries(saleDetail.paymentBreakdown || {}).map(([mode, amt]) => (
                <span key={mode} style={{ marginLeft: '12px', padding: '2px 8px', background: '#fff', borderRadius: '3px' }}>
                  {mode}: {amt.toFixed(2)}
                </span>
              ))}
            </div>

            <div className="modal-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="btn btn-secondary" onClick={handleConvertToReturn}>Convert to Return</button>
              <button className="btn btn-secondary" onClick={() => {
                window.api.printing.printSale(saleDetail.id, undefined, { duplicate: true })
                  .then((r) => { if (r && r.ok === false) setNotice(r.message); })
                  .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
              }}>Reprint Receipt</button>
              <button className="btn btn-primary" onClick={handleDuplicateAsNewSale}>Duplicate as New Sale</button>
              <button className="btn" onClick={() => setSaleDetail(null)}>Close</button>
            </div>
        </Modal>
      )}

{voidTarget && (
        <Modal
          onClose={() => setVoidTarget(null)}
          onSubmit={doVoid}
          title={`Void Sale ${voidTarget.invoice_no}`}
          className="modal-sm"
          showClose={false}
          closeOnOverlay={false}
        >
            <p className="muted">Stock will be restored automatically. This cannot be undone.</p>
            <label className="field">
              <span>Reason *</span>
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. wrong items scanned" />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setVoidTarget(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" disabled={!voidReason.trim()} onClick={doVoid}>
                Confirm Void
              </button>
            </div>
        </Modal>
      )}

      {openShiftModal && (
        <Modal
          onClose={() => setOpenShiftModal(false)}
          title="Open Shift"
          className="modal-sm"
        >
            <p className="muted">Enter the cash you are starting with in the drawer. Every sale until you close this shift is tagged to it.</p>
            <label className="field">
              <span>Starting cash</span>
              <KeyboardInput
                type="text"
                decimals
                autoFocus
                value={openCash}
                onChange={(e) => setOpenCash(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setOpenShiftModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const c = Number(openCash) || 0;
                  if (c < 0) {
                    setNotice('Starting cash cannot be negative');
                    return;
                  }
                  try {
                    const s = await window.api.shifts.open(c);
                    setShift(s);
                    setOpenShiftModal(false);
                    setNotice(`Shift opened with ${c.toFixed(2)} starting cash`);
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Start Shift
              </button>
            </div>
        </Modal>
      )}

      {closeShiftModal && (
        <Modal
          onClose={() => setCloseShiftModal(null)}
          onSubmit={doCloseShift}
          title="Close Shift"
          className="modal-sm"
        >
            <div className="summary-row">
              <span>Opening cash</span>
              <span>{closeShiftModal.start_cash.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Cash sales</span>
              <span>{closeShiftModal.cash_sales.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Cash refunds</span>
              <span>-{closeShiftModal.cash_refunds.toFixed(2)}</span>
            </div>
            <div className="summary-row total">
              <span>Expected cash</span>
              <span>{closeShiftModal.expected_preview.toFixed(2)}</span>
            </div>
            <label className="field">
              <span>Counted cash in drawer *</span>
              <KeyboardInput
                type="text"
                decimals
                autoFocus
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="field">
              <span>Notes (optional)</span>
              <input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="e.g. busy evening shift" />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setCloseShiftModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={doCloseShift}>
                Close Shift
              </button>
            </div>
        </Modal>
      )}
{priceEditUnlockOpen && (
  <Modal
    onClose={() => setPriceEditUnlockOpen(false)}
    title={<span className="text-warn">Unlock Price Editing</span>}
    className="modal-sm"
    showClose={false}
    closeOnOverlay={false}
  >
      <label className="field">
        <span>Manager</span>
        <select value={priceEditUserId ?? ''} onChange={(e) => setPriceEditUserId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Select manager</option>
          {managerUsers.filter(u => u.role === 'owner' || u.role === 'manager').map(u => (
            <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>PIN / Password</span>
        <input type="password" value={priceEditPin} onChange={(e) => setPriceEditPin(e.target.value)} />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={() => { setPriceEditUnlockOpen(false); setPriceEditPin(''); setPriceEditUserId(null); }}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          disabled={!priceEditUserId || !priceEditPin}
          onClick={async () => {
            if (!priceEditUserId) { setNotice('Select manager'); return; }
            const ok = await window.api.auth.verifyForUser(priceEditUserId, priceEditPin);
            if (!ok) { setNotice('Invalid credentials'); return; }
            setPriceEditEnabled(true);
            setPriceEditUnlockOpen(false);
            setPriceEditPin('');
            setPriceEditUserId(null);
          }}
        >
          Unlock
        </button>
      </div>
  </Modal>
)}
  {cashDrawerOpen && shift && (
    <CashDrawer shift={shift} onClose={() => setCashDrawerOpen(false)} />
  )}

  {/* Running Total Fixed Bottom Bar */}
  {items.length > 0 && (
    <div className="running-total-bar" style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 900,
      background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', padding: '8px 20px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      boxShadow: '0 -4px 20px rgba(79, 70, 229, 0.3)', fontSize: 14, fontWeight: 600,
    }}>
      <span>{items.length} item{items.length > 1 ? 's' : ''} in bill</span>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{formatMoney(finalTotal)}</span>
      <button
        className="btn btn-sm"
        style={{ background: '#fff', color: 'var(--primary)', fontWeight: 700, border: 'none' }}
        onClick={() => expressCheckout()}
        disabled={expressBusy || !shift}
      >
        ⚡ Pay Cash
      </button>
    </div>
  )}
  </>
);
}