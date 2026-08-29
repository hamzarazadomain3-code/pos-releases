import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CashDrawer from '../components/CashDrawer';
import type {
  Customer,
  HeldBill,
  Product,
  ProductUnit,
  ResolvedPromotion,
  Sale,
  SaleDetail,
  SaleCreateResult,
  SaleItem,
  ShiftDetail,
  ShiftRow,
  UserRow,
} from '../../../shared/types';

interface CartLine {
  product_id: number;
  name: string;
  qty: number;
  price: number;
  retail_price: number;
  wholesale_price: number | null;
  cost_price: number;
  line_discount: number;
  tax_rate: number;
  expired: boolean;
  shelf_location: string | null;
  stock_qty: number;
  units: ProductUnit[];
  selected_unit_level: number;
  box_qty?: number;
  // BayLan Label Scale integration
  scale_plu?: string;         // PLU code from scale barcode
  scale_price?: number;       // decoded total price from scale barcode
  scale_weight_g?: number;    // weight in grams (computed from decoded price / per-kg price)
  scale_weight_kg?: number;   // weight in kg (for backend inventory deduction)
  // Optional unit display fields (for multi-unit products)
  unit_name?: string | null;
  display_qty?: number | null;
}

function isExpired(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00').getTime() < today.getTime();
}

interface PayRow {
  mode: string;
  amount: string;
}

const MODES = ['Cash', 'Card', 'Easypaisa', 'JazzCash'];

function lineTotals(
  items: CartLine[],
  billDiscount: number,
  discountType: 'amount' | 'percent',
  promos: Record<number, ResolvedPromotion>
) {
  let subtotal = 0;
  let tax = 0;
  let promoSavings = 0;
  for (const it of items) {
    const promo = promos[it.product_id];
    const unit = promo ? promo.effective_price : it.price;
    const taxable = unit * it.qty - it.line_discount;
    subtotal += taxable;
    tax += (taxable * it.tax_rate) / 100;
    if (promo) promoSavings += (it.price - promo.effective_price) * it.qty;
  }
  const gross = subtotal + tax;
  const discount = discountType === 'percent' ? (gross * billDiscount) / 100 : Math.min(billDiscount, gross);
  const total = Math.max(0, gross - discount);
  return { subtotal: gross, tax, discount, total, promoSavings };
}

export default function Billing() {
  const [items, setItems] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [quotationMode, setQuotationMode] = useState(false);
  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [billDiscount, setBillDiscount] = useState('');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
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
  const [history, setHistory] = useState<Sale[] | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'completed' | 'voided' | 'held'>('completed');
  const [voidReason, setVoidReason] = useState('');
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [promoMap, setPromoMap] = useState<Record<number, ResolvedPromotion>>({});
  const [historyFilters, setHistoryFilters] = useState<{
    from: string;
    to: string;
    saleNo: string;
    customerId: string;
    userId: string;
    paymentMode: string;
    productId: string;
    minAmount: string;
    maxAmount: string;
    sortBy: 'date' | 'amount' | 'saleNo';
    sortOrder: 'asc' | 'desc';
    onlyMySales: boolean;
    status: 'completed' | 'voided' | 'held';
  }>({
    from: '',
    to: '',
    saleNo: '',
    customerId: '',
    userId: '',
    paymentMode: '',
    productId: '',
    minAmount: '',
    maxAmount: '',
    sortBy: 'date',
    sortOrder: 'desc',
    onlyMySales: false,
    status: 'completed',
  });
  const [datePreset, setDatePreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'lastmonth' | 'custom'>('month');
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
  const [priceFloorUserId, setPriceFloorUserId] = useState<number | null>(null);
  const [priceEditEnabled, setPriceEditEnabled] = useState(true);
  const [priceEditUnlockOpen, setPriceEditUnlockOpen] = useState(false);
  const [priceEditUserId, setPriceEditUserId] = useState<number | null>(null);
  const [priceEditPin, setPriceEditPin] = useState('');
  const [serviceCharge, setServiceCharge] = useState('');
  const [serviceChargeType, setServiceChargeType] = useState<'amount' | 'percent'>('amount');
  const [freight, setFreight] = useState('');
  const [scannerLastSeen, setScannerLastSeen] = useState<number | null>(null);
  const [scannerConnected, setScannerConnected] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [cashDrawerOpen, setCashDrawerOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [quotationCount, setQuotationCount] = useState(0);
  const [currentHeldId, setCurrentHeldId] = useState<number | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [shortcutMap, setShortcutMap] = useState<Record<string, string>>({});
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const totals = useMemo(() => lineTotals(items, Number(billDiscount) || 0, discountType, promoMap), [items, billDiscount, discountType, promoMap]);
const serviceChargeAmt = serviceChargeType === 'percent'
  ? (totals.total * (Number(serviceCharge) || 0)) / 100
  : Number(serviceCharge) || 0;
const freightAmt = Number(freight) || 0;
const grandTotal = totals.total + serviceChargeAmt + freightAmt;

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
     (p: Product, scaleOpts?: { scale_plu: string; scale_price: number }) => {
      const expired = isExpired(p.expiry_date);
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
              ? { ...i, qty: i.qty + 1, expired: expired || i.expired }
              : i
          );
        }
        const qty = 1;
        const price = (p as any).sale_price;
        return [
          ...prev,
          {
            product_id: p.id,
            name: p.name,
            qty,
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
      })
      .then(() => {
        setItems([]);
        setBillDiscount('');
        setNotice('Bill held. Use "Held" to resume.');
      updateHeldCounts();
      })
      .catch((e) => setNotice(e.message));
  }, [items, customerId, billDiscount, discountType, priceMode]);

const newBill = useCallback(() => {
  setItems([]);
  setSearch('');
  setBillDiscount('');
  setSuccess(null);
  setQuotationMode(false);
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
    const off = window.api.admin.settings.onChange?.(() => {
      window.api.admin.shortcuts.getAll().then((rows) => {
        const map: Record<string, string> = {};
        for (const r of rows) map[r.action] = r.shortcut_key;
        setShortcutMap(map);
      }).catch(() => undefined);
      window.api.admin.settings.get('auto_print_receipt').then((v) => {
        setAutoPrintReceipt(v === 'true' || v === '1');
      }).catch(() => undefined);
    });
    return () => { if (off) off(); };
  }, []);

  useEffect(() => { updateHeldCounts(); }, []);

  // adjust price‑edit enable flag when role changes
  useEffect(() => {
    setPriceEditEnabled(userRole !== 'cashier');
  }, [userRole]);

  useEffect(() => {
    // Load manager users and price floor setting
    window.api.users.list().then(setManagerUsers).catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
    window.api.settings.getAll().then((s) => setPriceFloorEnabled(s['price_floor_enabled'] !== '0')).catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    window.api.shifts
      .current()
      .then(setShift)
      .catch(() => setShift(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      window.api.inventory
        .list(search.trim() || undefined)
        .then((r) => {
          if (!cancelled) setResults(r);
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

  useEffect(() => {
    let buffer = '';
    let last = 0;
    let burstCount = 0;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const combo = ctrl ? `ctrl+${key}` : key;

      // Dynamic shortcuts from admin settings
      if (shortcutMap['focus_search'] && combo === shortcutMap['focus_search'].toLowerCase()) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (shortcutMap['new_bill'] && combo === shortcutMap['new_bill'].toLowerCase()) {
        e.preventDefault();
        newBill();
        return;
      }
      if (shortcutMap['hold_bill'] && combo === shortcutMap['hold_bill'].toLowerCase()) {
        e.preventDefault();
        doHold();
        return;
      }
      if (shortcutMap['hold_list'] && combo === shortcutMap['hold_list'].toLowerCase()) {
        e.preventDefault();
        openHeld('held');
        return;
      }
      if (shortcutMap['payment'] && combo === shortcutMap['payment'].toLowerCase()) {
        e.preventDefault();
        if (items.length > 0 && payTotal > 0) setPayOpen(true);
        return;
      }
      if (shortcutMap['price_mode'] && combo === shortcutMap['price_mode'].toLowerCase()) {
        e.preventDefault();
        setPriceMode((m) => m === 'retail' ? 'wholesale' : 'retail');
        return;
      }
      if (shortcutMap['cash_drawer'] && combo === shortcutMap['cash_drawer'].toLowerCase()) {
        e.preventDefault();
        if (shift) setCashDrawerOpen(true);
        return;
      }

      // Fallback hardcoded keys (in case no shortcut configured)
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'F5') { e.preventDefault(); newBill(); return; }
      if (e.key === 'F9') { e.preventDefault(); doHold(); return; }
      if (e.key === 'F12') { e.preventDefault(); openHeld('held'); return; }
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
        if (now - last > 150) {
          buffer = '';
          burstCount = 0;
        }
        buffer += e.key;
        last = now;
        burstCount++;
        if (burstCount >= 4) setScannerLastSeen(Date.now());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scanAdd, newBill, doHold, shortcutMap]);

  async function handleSearchEnter() {
    const q = search.trim();
    if (!q) return;
    const exact = results.find((r) => r.barcode === q || r.sku === q);
    if (exact) {
      addProduct(exact);
      setSearch('');
      return;
    }
    try {
      const byBarcode = await window.api.inventory.getByBarcode(q);
      if (byBarcode) {
        addProduct(byBarcode);
        setSearch('');
        return;
      }
    } catch {
      /* ignore */
    }
    if (results[0]) {
      addProduct(results[0]);
      setSearch('');
    } else {
      setNotice(`No product found for "${q}"`);
    }
  }

function openPay() {
  const expired = items.filter((i) => i.expired);
  if (expired.length > 0) {
    setExpiredConfirm(expired);
    return;
  }
  if (priceFloorEnabled) {
    const belowCost = items.filter((i) => {
      // Scale item: price is decoded TOTAL, cost_price is per-KG → prorate cost by weight
      if (i.scale_price != null && i.scale_weight_kg != null && i.scale_weight_kg > 0) {
        const actualCost = i.cost_price * i.scale_weight_kg;
        return i.price < actualCost;
      }
      // Normal item: both price and cost are per-unit
      return i.price < i.cost_price;
    });
    if (belowCost.length > 0) {
      setBelowCostConfirm(belowCost);
      return;
    }
  }
  setPayRows([{ mode: 'Cash', amount: grandTotal.toFixed(2) }]);
  setPayOpen(true);
}

  async function completeSale() {
    setBusy(true);
    try {
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
                qty: Math.round(i.scale_weight_kg * 1000) / 1000,          // KG stored in DB
                price: pricePerKg,               // price per KG (total / weight)
                line_discount: i.line_discount,
                tax_rate: i.tax_rate,
                box_qty: undefined,
                unit_name: 'Gram',
                display_qty: Math.round((i.scale_weight_g ?? 0) * 1000) / 1000,   // show "234 gram" on receipt
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
            };
          }),
          customer_id: customerId ? Number(customerId) : null,
          bill_discount: Number(billDiscount) || 0,
          discount_type: discountType,
          price_floor_override: priceFloorOverride,
          price_mode: priceMode,
          service_charge: Number(serviceCharge) || 0,
          service_charge_type: serviceChargeType,
          freight: freightAmt,
          payments: rows,
        });
      setPayOpen(false);
      setSuccess(result);
      setItems([]);
      setBillDiscount('');
      setPriceFloorOverride(false);
      setPriceFloorUserId(null);
      setPriceFloorPin('');
      // Auto-print receipt if enabled
      if (autoPrintReceipt && result.sale?.id) {
        window.api.printing.printSale(result.sale.id).catch(() => undefined);
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
      const data = JSON.parse(h.data);
      setItems(data.items ?? []);
      setCustomerId(data.customer_id ?? '');
      setBillDiscount(String(data.bill_discount ?? ''));
      setDiscountType(data.discount_type ?? 'amount');
      switchPriceMode(data.price_mode === 'wholesale' ? 'wholesale' : 'retail');
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
    await applyHistoryFilters();
  }

  async function loadCashiers() {
    try {
      const users = await window.api.users.list();
      setCashiers(users.filter(u => u.role === 'cashier' || u.role === 'owner' || u.role === 'manager'));
    } catch (e) {
      console.error('Failed to load cashiers:', e);
    }
  }

  async function applyHistoryFilters() {
    const isCashier = userRole === 'cashier';
    const onlyMySales = historyFilters.onlyMySales || (userRole === 'cashier' && !historyFilters.onlyMySales);
    
    setHistory(await window.api.sales.list(
      historyFilters.from || undefined,
      historyFilters.to || undefined,
      historyFilters.status !== 'voided',
      historyFilters.customerId ? Number(historyFilters.customerId) : undefined,
      onlyMySales ? undefined : (historyFilters.userId ? Number(historyFilters.userId) : undefined),
      historyFilters.paymentMode || undefined,
      historyFilters.productId ? Number(historyFilters.productId) : undefined,
      historyFilters.minAmount ? Number(historyFilters.minAmount) : undefined,
      historyFilters.maxAmount ? Number(historyFilters.maxAmount) : undefined,
      historyFilters.saleNo || undefined,
      historyFilters.sortBy,
      historyFilters.sortOrder,
      historyFilters.onlyMySales,
      historyFilters.status
    ));
  }

  function applyDatePreset(preset: typeof datePreset) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let from: Date, to: Date;
    
    switch (preset) {
      case 'today':
        from = new Date(today);
        to = new Date(today);
        break;
      case 'yesterday':
        from = new Date(today);
        from.setDate(from.getDate() - 1);
        to = new Date(from);
        break;
      case 'week':
        from = new Date(today);
        from.setDate(from.getDate() - 6);
        to = new Date(today);
        break;
      case 'month':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        to = new Date(today);
        break;
      case 'lastmonth':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'custom':
        setDatePreset('custom');
        return;
    }
    setHistoryFilters(f => ({ ...f, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }));
    setDatePreset(preset);
  }

  function clearHistoryFilters() {
    setHistoryFilters({
      from: '',
      to: '',
      saleNo: '',
      customerId: '',
      userId: '',
      paymentMode: '',
      productId: '',
      minAmount: '',
      maxAmount: '',
      sortBy: 'date',
      sortOrder: 'desc',
      onlyMySales: userRole === 'cashier',
      status: 'completed',
    });
    setDatePreset('month');
    applyHistoryFilters();
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
    setSaleDetail(null);
    // Navigate to Returns page with sale pre-selected
    // Store sale ID in localStorage for Returns page to pick up
    localStorage.setItem('return_sale_id', String(saleDetail.id));
    // The Returns page should check for this on load
    setNotice('Opening Returns page...');
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
      const includeVoided = historyFilters.status === 'voided' || historyFilters.status === 'held';
      setHistory(await window.api.sales.list(
        historyFilters.from || undefined,
        historyFilters.to || undefined,
        includeVoided,
        historyFilters.customerId ? Number(historyFilters.customerId) : undefined,
        historyFilters.userId ? Number(historyFilters.userId) : undefined,
        historyFilters.paymentMode || undefined,
        historyFilters.productId ? Number(historyFilters.productId) : undefined,
        historyFilters.minAmount ? Number(historyFilters.minAmount) : undefined,
        historyFilters.maxAmount ? Number(historyFilters.maxAmount) : undefined,
        historyFilters.saleNo || undefined,
        historyFilters.sortBy,
        historyFilters.sortOrder,
        historyFilters.onlyMySales,
        historyFilters.status
      ));
      setNotice('Sale voided. Stock restored.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  const payTotal = payRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

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
      <div className={shift ? 'shift-bar ok' : 'shift-bar warn'}>
        {shift ? (
          <>
            <span>
              Shift open · started {new Date(shift.opened_at).toLocaleTimeString()} · opening cash {shift.start_cash.toFixed(2)}
            </span>
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  const d = await window.api.shifts.get(shift.id);
                  setCloseShiftModal(d);
                  setCountedCash('');
                  setCloseNotes('');
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Close Shift
            </button>
          </>
        ) : (
          <>
            <span>No open shift — you must open one before charging sales.</span>
            <button className="btn btn-sm" onClick={() => setOpenShiftModal(true)}>
              Open Shift
            </button>
          </>
        )}
      </div>
      <div className="billing-top">
        <input
          ref={searchRef}
          className="search-input billing-search"
          placeholder="Search or scan barcode... (F2)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSearchEnter();
            }
          }}
        />
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="field-select">
          <option value="">No customer (Cash)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.balance > 0 ? `(due ${c.balance})` : ''}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => setCustModal(true)}>
          + Customer
        </button>
        <button className={quotationMode ? 'btn btn-sm btn-quote active' : 'btn btn-sm btn-quote'} onClick={() => setQuotationMode(!quotationMode)}>
          {quotationMode ? 'Quotation ON' : 'Quotation'}
        </button>
        <button className="btn btn-sm" onClick={() => openHeld('held')}>
          Held ({heldCount})
        </button>
        <button className="btn btn-sm" onClick={() => openHeld('quotation')}>
Quotes ({quotationCount})
        </button>
        <button className="btn btn-sm" onClick={openHistory}>
          History
        </button>
        <button
          className="btn btn-sm"
          onClick={handleOpenCashDrawer}
          disabled={drawerBusy}
          title="Opens the cash drawer via the receipt printer (ESC/POS kick)"
        >
          {drawerBusy ? 'Opening…' : 'Cash Drawer'}
        </button>
        <button className="btn btn-sm" onClick={newBill}>
          New (F5)
        </button>
        <span className={`scanner-ind ${scannerConnected ? 'ok' : ''}`} title={scannerConnected ? 'Barcode scanner activity detected' : 'No barcode scanner activity — scan a barcode to connect'}>
          <span className="scanner-dot" />
          {scannerConnected
            ? (scannerLastSeen && (Date.now() - scannerLastSeen < 5000)
                ? 'Scanner: Active'
                : 'Scanner: Connected')
            : 'Scanner: Not detected'}
        </span>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="billing-body">
        <div className="panel panel-results">
          <div className="panel-title">Products ({results.length})</div>
          <div className="result-list">
            {results.map((r) => (
              <button key={r.id} className="result-item" onClick={() => addProduct(r)}>
                <span className="result-name">{r.name}</span>
                <span className="result-meta">
                  {r.sale_price}
                  {r.wholesale_price != null ? ` • W ${r.wholesale_price}` : ''}
                  {r.shelf_location ? ` • ${r.shelf_location}` : ''}
                   {r.stock_qty > 0 ? ` • ${Number(r.stock_qty.toFixed(3))} in stock` : ' • out of stock'}
                </span>
              </button>
            ))}
            {results.length === 0 && <div className="muted center pad">Type to search products</div>}
          </div>
        </div>

        <div className="panel panel-cart">
          <div className="panel-title">
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
          <div className="cart-list">
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
                <div className={it.expired ? 'cart-row cart-row-expired' : 'cart-row'} key={`${it.product_id}-${idx}`}>
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
                    {it.stock_qty != null && ((isScaleItem && (it.scale_weight_kg ?? 0) > it.stock_qty) || (!isScaleItem && it.qty > it.stock_qty)) && (
                      <div className="small text-warn">
                        Stock kam hai — sirf {isScaleItem ? Number(it.stock_qty.toFixed(3)) : availableLabel} {isScaleItem ? 'kg' : `${selectedUnit?.name || 'pcs'}`} available
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
              <div className="muted center pad">
                Bill is empty — search products or scan barcodes.
              </div>
            )}
          </div>
        </div>

        <div className="panel panel-summary">
          <div className="panel-title">Summary</div>
          {items.some((i) => i.expired) && (
            <div className="expiry-warning-banner">
              <strong>Warning:</strong> This bill contains expired item(s):{' '}
              {items.filter((i) => i.expired).map((i) => i.name).join(', ')}. You will be asked to
              confirm before charging.
            </div>
          )}
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{totals.subtotal.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span>Tax</span>
            <span>{totals.tax.toFixed(2)}</span>
          </div>
          {totals.promoSavings > 0 && (
            <div className="summary-row">
              <span className="text-ok">Promo savings</span>
              <span className="text-ok">-{totals.promoSavings.toFixed(2)}</span>
            </div>
          )}
            <div className="summary-row">
              <span>Discount</span>
              <div className="discount-input">
                <input
                  type="number"
                  value={billDiscount}
                  onChange={(e) => setBillDiscount(e.target.value)}
                  placeholder="0"
                />
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}>
                  <option value="amount">Rs</option>
                  <option value="percent">%</option>
                </select>
              </div>
            </div>
            <div className="summary-row">
              <span>Service Charge</span>
              <div className="discount-input">
                <input
                  type="number"
                  value={serviceCharge}
                  onChange={(e) => setServiceCharge(e.target.value)}
                  placeholder="0"
                />
                <select value={serviceChargeType} onChange={(e) => setServiceChargeType(e.target.value as 'amount' | 'percent')}>
                  <option value="amount">Rs</option>
                  <option value="percent">%</option>
                </select>
              </div>
            </div>
            <div className="summary-row">
              <span>Freight/Delivery</span>
              <div className="discount-input">
                <input
                  type="number"
                  value={freight}
                  onChange={(e) => setFreight(e.target.value)}
                  placeholder="0"
                />
                <span className="discount-input-unit">Rs</span>
              </div>
            </div>
          <div className="summary-row total">
            <span>Total</span>
            <span>{grandTotal.toFixed(2)}</span>
          </div>
          <div className="summary-actions">
            <button className="btn btn-primary btn-lg" onClick={quotationMode ? completeQuotation : openPay} disabled={items.length === 0 || busy || (!quotationMode && !shift)}>
              {busy ? 'Working...' : quotationMode ? 'Save Quotation' : `Charge ${grandTotal.toFixed(2)}`}
            </button>
            <button className="btn btn-lg" onClick={doHold} disabled={items.length === 0}>
              Hold (F9)
            </button>
          </div>
          <div className="shortcuts muted small">
            F2 search • F5 new bill • F9 hold • Enter adds item
          </div>
        </div>
      </div>

      {expiredConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm">
            <h2 className="text-warn">Expired Items in Bill</h2>
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
          </div>
        </div>
      )}

      {payOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Payment — {grandTotal.toFixed(2)}</h2>
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
                <input
                  type="number"
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
              + Split payment
            </button>
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
          </div>
        </div>
      )}

      {success && (
        <div className="modal-overlay">
          <div className="modal modal-sm">
            <h2 className="text-ok">Sale Completed</h2>
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
                <button
                  className="btn"
                  onClick={() => {
                    window.api.printing.previewReceipt(success.sale.id).catch((e) => setNotice(e.message));
                  }}
                >
                  Preview Receipt
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    window.api.printing.printSale(success.sale.id).catch((e) => setNotice(e.message));
                  }}
                >
                  Print Receipt
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    window.api.printing.previewInvoice(success.sale.id).catch((e) => setNotice(e.message));
                  }}
                >
                  Preview Invoice
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    window.api.printing.printInvoice(success.sale.id).catch((e) => setNotice(e.message));
                  }}
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
              <button className="btn btn-primary" onClick={newBill}>
                New Bill
              </button>
            </div>
          </div>
        </div>
      )}

      {custModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm">
            <h2>New Customer</h2>
            <label className="field">
              <span>Name *</span>
              <input value={newCustName} onChange={(e) => setNewCustName(e.target.value)} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} />
            </label>
            <label className="field">
              <span>Opening Balance (Rs)</span>
              <input
                type="number"
                min="0"
                step="0.01"
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
          </div>
        </div>
      )}

      {heldModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{heldModal.tab === 'held' ? 'Held Bills' : 'Quotations'}</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Label</th>
                    <th>Saved</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {heldModal.rows.map((h) => (
                    <tr key={h.id}>
                      <td>{h.id}</td>
                      <td>{h.label}</td>
                      <td>{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-sm" onClick={() => resumeHeld(h)}>
                            {heldModal.tab === 'held' ? 'Resume' : 'Load'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={async () => {
                              await window.api.sales.deleteHeld(h.id);
                              openHeld(heldModal.tab);
                              updateHeldCounts();
                            }}
                          >
                            Del
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {heldModal.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted center">
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
          </div>
        </div>
      )}

      {history && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Sales History</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select className="field-select" value={historyFilter} onChange={(e) => { setHistoryFilter(e.target.value as any); applyHistoryFilters(); }} style={{ width: '160px' }}>
                  <option value="completed">Completed</option>
                  <option value="voided">Voided</option>
                  <option value="held">Held</option>
                </select>
              </div>
            </div>
            
            {/* Filter Bar */}
            <div className="filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', padding: '12px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
              {/* Row 1: Date Preset, Date Range, Sale No, Status, Sort */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
                <select className="field-select" value={datePreset} onChange={(e) => applyDatePreset(e.target.value as any)} style={{ width: '140px' }}>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="lastmonth">Last Month</option>
                  <option value="custom">Custom</option>
                </select>
                <input type="date" value={historyFilters.from} onChange={(e) => setHistoryFilters(f => ({ ...f, from: e.target.value }))} title="From Date" style={{ width: '140px' }} />
                <span className="muted">to</span>
                <input type="date" value={historyFilters.to} onChange={(e) => setHistoryFilters(f => ({ ...f, to: e.target.value }))} title="To Date" style={{ width: '140px' }} />
                <input type="text" value={historyFilters.saleNo} onChange={(e) => setHistoryFilters(f => ({ ...f, saleNo: e.target.value }))} placeholder="Sale No (INV-...)" style={{ width: '180px' }} />
                <select className="field-select" value={historyFilters.status} onChange={(e) => { setHistoryFilters(f => ({ ...f, status: e.target.value as 'completed' | 'voided' | 'held' })); applyHistoryFilters(); }} style={{ width: '140px' }}>
                  <option value="completed">Completed</option>
                  <option value="voided">Voided</option>
                  <option value="held">Held</option>
                </select>
                <select className="field-select" value={historyFilters.sortBy} onChange={(e) => { setHistoryFilters(f => ({ ...f, sortBy: e.target.value as 'date' | 'amount' | 'saleNo' })); applyHistoryFilters(); }} style={{ width: '140px' }}>
                  <option value="date">Sort: Date</option>
                  <option value="amount">Sort: Amount</option>
                  <option value="saleNo">Sort: Sale No</option>
                </select>
                <select className="field-select" value={historyFilters.sortOrder} onChange={(e) => { setHistoryFilters(f => ({ ...f, sortOrder: e.target.value as 'asc' | 'desc' })); applyHistoryFilters(); }} style={{ width: '100px' }}>
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
              
              {/* Row 2: Customer, Cashier, Payment, Product, Amount Range, Only My Sales */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
                <input type="text" value={historyFilters.customerId} onChange={(e) => setHistoryFilters(f => ({ ...f, customerId: e.target.value }))} placeholder="Customer name..." style={{ width: '180px' }} />
                <select className="field-select" value={historyFilters.userId} onChange={(e) => setHistoryFilters(f => ({ ...f, userId: e.target.value }))} style={{ width: '160px' }}>
                  <option value="">All Cashiers</option>
                  {cashiers.map(u => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
                </select>
                <select className="field-select" value={historyFilters.paymentMode} onChange={(e) => setHistoryFilters(f => ({ ...f, paymentMode: e.target.value }))} style={{ width: '140px' }}>
                  <option value="">All Payments</option>
                  {paymentModes.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <input type="text" value={historyFilters.productId} onChange={(e) => setHistoryFilters(f => ({ ...f, productId: e.target.value }))} placeholder="Product name..." style={{ width: '180px' }} />
                <input type="number" value={historyFilters.minAmount} onChange={(e) => setHistoryFilters(f => ({ ...f, minAmount: e.target.value }))} placeholder="Min Amt" step="0.01" style={{ width: '100px' }} />
                <input type="number" value={historyFilters.maxAmount} onChange={(e) => setHistoryFilters(f => ({ ...f, maxAmount: e.target.value }))} placeholder="Max Amt" step="0.01" style={{ width: '100px' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#333' }}>
                  <input type="checkbox" checked={historyFilters.onlyMySales} onChange={(e) => setHistoryFilters(f => ({ ...f, onlyMySales: e.target.checked }))} />
                  Only My Sales
                </label>
              </div>
              
              {/* Row 3: Actions */}
              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <button className="btn btn-sm" onClick={clearHistoryFilters}>Clear Filters</button>
                <button className="btn btn-primary btn-sm" onClick={applyHistoryFilters}>Apply</button>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Sale No</th>
                    <th>Customer</th>
                    <th>Cashier</th>
                    <th>Payment</th>
                    <th>Subtotal</th>
                    <th>Discount</th>
                    <th>Tax</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.id} onClick={() => openSaleDetail(s.id)} style={{ cursor: 'pointer' }}>
                      <td>{s.invoice_no}</td>
                      <td>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                      <td>{s.created_at ? new Date(s.created_at).toLocaleTimeString() : '—'}</td>
                      <td>{s.invoice_no}</td>
                      <td>{s.customer_name ?? 'Walk-in'}</td>
                      <td>{s.cashier_name ?? '—'}</td>
                      <td>{Object.keys((s as any).paymentBreakdown || {}).join(', ') || '—'}</td>
                      <td>{(s as any).subtotal?.toFixed(2) ?? '—'}</td>
                      <td>{(s as any).discount_amount?.toFixed(2) ?? '—'}</td>
                      <td>{(s as any).tax_amount?.toFixed(2) ?? '—'}</td>
                      <td>{s.total_amount.toFixed(2)}</td>
                      <td>
                        <span className={`badge ${s.status === 'voided' ? 'badge-danger' : s.status === 'held' ? 'badge-warn' : ''}`}>{s.status}</span>
                      </td>
                      <td>
                        {s.status === 'completed' && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setVoidTarget(s);
                              setVoidReason('');
                            }}
                          >
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setHistory(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Below cost confirmation modal */}
      {belowCostConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm">
            <h2 className="text-warn">Below-Cost Items</h2>
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
          </div>
        </div>
      )}
        {saleDetail && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Sale Detail — {saleDetail.invoice_no}</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={handleConvertToReturn}>Convert to Return</button>
                <button className="btn btn-secondary" onClick={() => window.api.printing.printSale(saleDetail.id)}>Reprint Receipt</button>
                <button className="btn btn-primary" onClick={handleDuplicateAsNewSale}>Duplicate as New Sale</button>
                <button className="btn" onClick={() => setSaleDetail(null)}>Close</button>
              </div>
            </div>
            
            {/* Header Info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '4px' }}>
              <div><strong>Date:</strong> {saleDetail.created_at ? new Date(saleDetail.created_at).toLocaleString() : '—'}</div>
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
              <button className="btn btn-secondary" onClick={() => window.api.printing.printSale(saleDetail.id)}>Reprint Receipt</button>
              <button className="btn btn-primary" onClick={handleDuplicateAsNewSale}>Duplicate as New Sale</button>
              <button className="btn" onClick={() => setSaleDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

{voidTarget && (
        <div className="modal-overlay">
          <div className="modal modal-sm">
            <h2>Void Sale {voidTarget.invoice_no}</h2>
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
          </div>
        </div>
      )}

      {openShiftModal && (
        <div className="modal-overlay" onClick={() => setOpenShiftModal(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Open Shift</h2>
            <p className="muted">Enter the cash you are starting with in the drawer. Every sale until you close this shift is tagged to it.</p>
            <label className="field">
              <span>Starting cash</span>
              <input
                type="number"
                min="0"
                step="0.01"
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
          </div>
        </div>
      )}

      {closeShiftModal && (
        <div className="modal-overlay" onClick={() => setCloseShiftModal(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Close Shift</h2>
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
              <input
                type="number"
                min="0"
                step="0.01"
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
          </div>
        </div>
      )}
    </div>
{priceEditUnlockOpen && (
  <div className="modal-overlay">
    <div className="modal modal-sm">
      <h2 className="text-warn">Unlock Price Editing</h2>
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
    </div>
  </div>
)}
  {cashDrawerOpen && shift && (
    <CashDrawer shift={shift} onClose={() => setCashDrawerOpen(false)} />
  )}
  </>
);
}