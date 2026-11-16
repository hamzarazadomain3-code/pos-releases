/**
 * The step-by-step guides — the "dikha do" mode.
 *
 * A guide is a short, fixed list of steps that points at the controls of the
 * app. The assistant NEVER clicks for the user: it starts the guide and the
 * guide highlights the control of the current step (the `data-guide-id`
 * anchor), so the shop owner does the work and the app never acts on its own.
 *
 * The guide catalogue lives here, in the shared folder, so the main process
 * (the model-facing text) and the renderer (the overlay) read the SAME steps
 * — there is no second copy of a guide.
 *
 * The text is in the shop's two languages (English and Urdu) in the same
 * entry, because a guide is app content that belongs to the assistant
 * feature — not to the page it points at.
 */
import type { AssistantLanguage } from './types';

export interface GuideStep {
  /** The step id (unique inside the guide). */
  id: string;
  /**
   * The `data-guide-id` of the control the step points at. The overlay looks
   * the control up in the DOM; when it is not on the screen the step still
   * reads as text (the guide never breaks).
   */
  anchor: string;
  title: string;
  body: string;
  titleUr: string;
  bodyUr: string;
}

export interface Guide {
  id: string;
  title: string;
  titleUr: string;
  /** The page the guide belongs to (a route from the app's own menu). */
  route: string;
  /** The words that make this guide match a search ("bill", "invoice"…). */
  keywords: string[];
  steps: GuideStep[];
}

export const GUIDES: Guide[] = [
  {
    id: 'make_a_bill',
    title: 'Make a bill',
    titleUr: 'بل بنائیں',
    route: 'billing',
    keywords: ['bill', 'sale', 'invoice', 'billing', 'checkout', 'sell', 'counter'],
    steps: [
      {
        id: 'search',
        anchor: 'billing.search',
        title: 'Find the item',
        body: 'Click the search box at the top and type the item name — or scan its barcode with the scanner.',
        titleUr: 'سامنا ڈھونڈیں',
        bodyUr: 'اوپر والے سرچ باکس میں کلک کریں اور سامنا کا نام لکھیں — یا اسکینر سے بارکوڈ پڑھوائیں۔',
      },
      {
        id: 'add',
        anchor: 'billing.cart',
        title: 'Add it to the bill',
        body: 'Press Enter on the item. It goes into the bill on the right; press Enter again to change the quantity.',
        titleUr: 'بل میں شامل کریں',
        bodyUr: 'سامنا پر Enter دبائیں۔ یہ بل میں چلی جاتا ہے؛ دوبارہ Enter دبائیں تو مقدار بدل سکتے ہیں۔',
      },
      {
        id: 'customer',
        anchor: 'billing.customer',
        title: 'Choose the customer (only if there is one)',
        body: 'Type the customer name or their phone in the same box, or press F6 to pick one from the list.',
        titleUr: 'کسٹمر منتخب کریں (اگر ہو)',
        bodyUr: 'اسی باکس میں کسٹمر کا نام یا فون نمبر لکھیں، یا فہرست سے چننے کے لیے F6 دبائیں۔',
      },
      {
        id: 'payment',
        anchor: 'billing.payment',
        title: 'Take the payment',
        body: 'Press the payment button, choose how the customer is paying and confirm. The bill is saved and the receipt can be printed.',
        titleUr: 'ادائیگی لیں',
        bodyUr: 'ادائیگی کا بٹن دبائیں، طریقہ منتخب کریں اور تصدیق کریں۔ بل محفوظ ہو جاتا ہے اور رسید پرن ہو سکتی ہے۔',
      },
    ],
  },
  {
    id: 'add_a_product',
    title: 'Add a product to the stock',
    titleUr: 'اسٹاک میں سامنا شامل کریں',
    route: 'inventory',
    keywords: ['product', 'stock', 'inventory', 'item', 'add product', 'new product', 'price'],
    steps: [
      {
        id: 'open',
        anchor: 'inventory.add',
        title: 'Open Add Product',
        body: 'On the Inventory page press the Add Product button (Ctrl+N opens it too).',
        titleUr: 'ایڈ پروڈکٹ کھولیں',
        bodyUr: 'انوینٹری پیج پر ایڈ پروڈکٹ کا بٹن دبائیں (Ctrl+N سے بھی کھل جاتا ہے)۔',
      },
      {
        id: 'name',
        anchor: 'inventory.form.name',
        title: 'Write the name and the price',
        body: 'Type the item name, then the sale price and the cost price. The cost price is what the shop paid for it.',
        titleUr: 'نام اور قیمت لکھیں',
        bodyUr: 'سامنا کا نام لکھیں، پھر فروخت قیمت اور لاگت قیمت۔ لاگت قیمت وہ ہے جسے دکان نے ادا کیا۔',
      },
      {
        id: 'quantity',
        anchor: 'inventory.form.quantity',
        title: 'Set the quantity',
        body: 'Write how many pieces are in the stock now, and the low-stock threshold so you are warned in time.',
        titleUr: 'مقدار مقرر کریں',
        bodyUr: 'لکھیں کہ اس وقت اسٹاک میں کتنے ہیں، اور کم اسٹاک کی حد بھی تاکہ وقت پر خبردار ہو جائیں۔',
      },
      {
        id: 'save',
        anchor: 'inventory.form.save',
        title: 'Save it',
        body: 'Press Save. The item is now in the stock and can be sold on the billing screen.',
        titleUr: 'محفوظ کریں',
        bodyUr: 'سیو دبائیں۔ اب سامنا اسٹاک میں ہے اور بلنگ اسکرین پر بک سکتا ہے۔',
      },
    ],
  },
  {
    id: 'give_udhaar',
    title: 'Give udhaar (credit) to a customer',
    titleUr: 'کسٹمر کو اُدھار دیں',
    route: 'udhaar',
    keywords: ['udhaar', 'credit', 'udhaar do', 'debt', 'khata', 'customer balance'],
    steps: [
      {
        id: 'open',
        anchor: 'udhaar.new',
        title: 'Open the udhaar list',
        body: 'Go to the Udhaar page. Press the Add Customer button (Ctrl+N opens it too).',
        titleUr: 'اُدھار کی فہرست کھولیں',
        bodyUr: 'اُدھار کے صفحے پر جائیں۔ ایڈ کسٹمر کا بٹن دبائیں (Ctrl+N سے بھی کھل جاتا ہے)۔',
      },
      {
        id: 'details',
        anchor: 'udhaar.form.details',
        title: 'Write the name and the phone',
        body: 'The name is needed; the phone number lets the shop send the bill on WhatsApp later.',
        titleUr: 'نام اور فون نمبر لکھیں',
        bodyUr: 'نام ضروری ہے؛ فون نمبر سے دکان بعد میں بل واٹس ایپ پر بھیج سکتی ہے۔',
      },
      {
        id: 'save',
        anchor: 'modal.save',
        title: 'Save the customer',
        body: 'Press Save. The sale on credit is recorded separately — the customer\'s balance grows with every credit bill.',
        titleUr: 'کسٹمر محفوظ کریں',
        bodyUr: 'سیو دبائیں۔ اُدھار کا بل الگ رکھا جاتا ہے — ہر اُدھار بل سے کسٹمر کا بیلنس بڑھتا ہے۔',
      },
    ],  },
  {
    id: 'open_the_shift',
    title: 'Open and close the shift',
    titleUr: 'شیفٹ کھولیں اور بند کریں',
    route: 'billing',
    keywords: ['shift', 'drawer', 'cash drawer', 'open shift', 'close shift', 'day'],
    steps: [
      {
        id: 'open',
        anchor: 'billing.shift',
        title: 'Open the shift before the first bill',
        body: 'On the Billing screen press Open and count the cash in the drawer. That count is the starting point of the day.',
        titleUr: 'پہلے بل سے پہلے شیفٹ کھولیں',
        bodyUr: 'بلنگ اسکرین پر اوپن دبائیں اور درجے کے پیسے گنیں۔ یہ گنتی دن کی شروعات ہے۔',
      },
      {
        id: 'close',
        anchor: 'nav.shifts',
        title: 'Close it at the end of the day',
        body: 'The Shifts page lists every shift of the shop. Open the open one, count the drawer again and the app shows the difference between the counted and the expected cash.',
        titleUr: 'دن کے آخر میں بند کریں',
        bodyUr: 'شیفٹس پیج پر دکان کی ہر شیفٹ درج ہے۔ کھلی شیفٹ کھولیں، درجے کے پیسے دوبارہ گنیں اور ایپ گنتی اور متوقع رقم کا فرق دکھائے گی۔',
      },
    ],
  },
  {
    id: 'take_a_return',
    title: 'Take a return (refund)',
    titleUr: 'ریٹرن (رقم واپس) کریں',
    route: 'returns',
    keywords: ['return', 'refund', 'wapas', 'return karo', 'exchange'],
    steps: [
      {
        id: 'open',
        anchor: 'nav.returns',
        title: 'Open the returns page',
        body: 'The Returns page lists every completed bill. The bills you can return are the ones with a return button.',
        titleUr: 'ریٹرنز کا صفحہ کھولیں',
        bodyUr: 'ریٹرنز کے صفحے پر ہر مکمل بل درج ہے۔ جن بلوں میں واپسی ممکن ہے ان پر ریٹرن کا بٹن ہوتا ہے۔',
      },
      {
        id: 'pick',
        anchor: 'returns.list',
        title: 'Pick the bill',
        body: 'Find the bill by its number or the customer name and press Select on it.',
        titleUr: 'بل منتخب کریں',
        bodyUr: 'بل نمبر یا کسٹمر کے نام سے بل ڈھونڈیں اور اس پر Select دبائیں۔',
      },
      {
        id: 'items',
        anchor: 'returns.items',
        title: 'Choose what goes back',
        body: 'Tick the items to return, write the quantity and press the return button. The money goes back the way it came.',
        titleUr: 'انتخاب کریں کہ کیا واپس جائے گا',
        bodyUr: 'واپس جانے والے سامنے پر نشان لگائیں، مقدار لکھیں اور ریٹرن دبائیں۔ رقم وہیں سے واپس جائے گی جہاں سے آئی تھی۔',
      },
    ],
  },
  {
    id: 'read_the_dashboard',
    title: 'Read the dashboard',
    titleUr: 'ڈیش بورڈ پڑھیں',
    route: 'dashboard',
    keywords: ['dashboard', 'today sale', 'aaj', 'profit', 'report', 'kamaai'],
    steps: [
      {
        id: 'today',
        anchor: 'dashboard.today',
        title: "Today's sale",
        body: "The first card is today's sale total and the number of bills. It is the shop's own Dashboard — the same number the day ends with.",
        titleUr: 'آج کی فروخت',
        bodyUr: 'پہلی کارڈ آج کی فروخت اور بلوں کی تعداد ہے۔ یہ دکان کا اپنا ڈیش بورڈ ہے۔',
      },
      {
        id: 'cards',
        anchor: 'dashboard.cards',
        title: 'The cards below',
        body: 'Low stock, the udhaar due, the expenses and the profit. Each card opens the report behind it.',
        titleUr: 'نیچے والی کارڈز',
        bodyUr: 'کم اسٹاک، واجب اُدھار، اخراجات اور منافع۔ ہر کارڈ اپنی رپورٹ کھولتا ہے۔',
      },
    ],
  },
];

/** The guide with that id (undefined when there is none). */
export function guideById(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}

/** The guides that belong to a page. */
export function guidesForRoute(route: string | null | undefined): Guide[] {
  if (!route) return [];
  return GUIDES.filter((g) => g.route === route);
}

/** The step text in the language the shop reads. */
export function stepText(
  step: GuideStep,
  language: AssistantLanguage = 'en'
): { title: string; body: string } {
  if (language === 'ur') return { title: step.titleUr, body: step.bodyUr };
  return { title: step.title, body: step.body };
}

/** The guide title in the language the shop reads. */
export function guideTitle(guide: Guide, language: AssistantLanguage = 'en'): string {
  if (language === 'ur') return guide.titleUr;
  return guide.title;
}

// ── the step machine ───────────────────────────────────────────────────────

export type GuideAction =
  | { type: 'start'; guideId: string }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; stepIndex: number }
  | { type: 'stop' };

export interface GuideState {
  /** The guide that is running (null when none is). */
  guideId: string | null;
  /** The step that is showing (0 = the first one). */
  stepIndex: number;
  /** True when the guide has run to its end. */
  done: boolean;
}

export const INITIAL_GUIDE_STATE: GuideState = { guideId: null, stepIndex: 0, done: false };

/**
 * The step machine — a pure reducer, so the overlay and the test can never
 * disagree about where the guide is.
 */
export function guideReducer(state: GuideState, action: GuideAction): GuideState {
  if (action.type === 'start') {
    const guide = guideById(action.guideId);
    if (!guide) return { ...state, guideId: null, stepIndex: 0, done: true };
    return { guideId: guide.id, stepIndex: 0, done: false };
  }
  if (action.type === 'stop') return { ...INITIAL_GUIDE_STATE };
  if (!state.guideId) return state;
  const guide = guideById(state.guideId);
  if (!guide) return { ...INITIAL_GUIDE_STATE };
  if (action.type === 'goto') {
    const index = Math.max(0, Math.min(guide.steps.length - 1, Math.floor(action.stepIndex)));
    return { ...state, stepIndex: index, done: false };
  }
  if (action.type === 'next') {
    const next = state.stepIndex + 1;
    if (next >= guide.steps.length) return { ...state, done: true };
    return { ...state, stepIndex: next, done: false };
  }
  // 'prev' — from the end it comes back to the LAST step, not before it.
  const prev = state.done ? guide.steps.length - 1 : state.stepIndex - 1;
  return { ...state, stepIndex: Math.max(0, prev), done: false };
}

/** The step the overlay shows right now. */
export function currentStep(state: GuideState): GuideStep | null {
  if (!state.guideId || state.done) return null;
  const guide = guideById(state.guideId);
  if (!guide) return null;
  return guide.steps[state.stepIndex] ?? null;
}

/** How many steps the running guide has. */
export function stepCount(state: GuideState): number {
  if (!state.guideId) return 0;
  return guideById(state.guideId)?.steps.length ?? 0;
}
