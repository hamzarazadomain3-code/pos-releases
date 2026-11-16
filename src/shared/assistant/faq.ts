/**
 * The FAQ — the questions the shop asks most, answered in one line.
 *
 * The FAQ is app content owned by the assistant feature (like the guides):
 * it lives in the shared folder so the main process (the model-facing text)
 * and the renderer read the SAME entry.
 *
 * Every entry names the page it is about, so the assistant can also point
 * the owner at the right screen.
 */

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  questionUr: string;
  answerUr: string;
  /** The page the answer is about (a route from the app's own menu). */
  route?: string;
  /** The words that make this entry match a search. */
  keywords: string[];
}

export const FAQ: FaqEntry[] = [
  {
    id: 'change_the_shop_name',
    question: 'How do I change the shop name and the logo?',
    answer: 'Admin → Shop Profile: the name, the address, the phone and the logo are all changed there and appear on the receipt.',
    questionUr: 'دکان کا نام اور لوگو کیسے بدلوں؟',
    answerUr: 'ایڈمن → شاپ پروفائل: نام، پتہ، فون اور لوگو وہیں بدلے جاتے ہیں اور رسید پر آ جاتے ہیں۔',
    route: 'admin',
    keywords: ['shop name', 'logo', 'brand', 'receipt', 'dukan ka naam'],
  },
  {
    id: 'open_the_drawer_without_a_bill',
    question: 'How do I open the cash drawer without making a bill?',
    answer: 'On the Billing screen the drawer opens with the payment. Otherwise use Cash Drawer in the menu.',
    questionUr: 'بل کے بغیر درجہ کیسے کھولوں؟',
    answerUr: 'بلنگ اسکرین پر ادائیگی کے ساتھ درجہ کھلتا ہے۔ ورنہ مینو میں کیش ڈراوَر استعمال کریں۔',
    route: 'billing',
    keywords: ['drawer', 'cash', 'open drawer', 'change'],
  },
  {
    id: 'give_a_customer_a_discount',
    question: 'How do I give a customer a standing discount?',
    answer: 'Open the customer from the Udhaar page and set the discount — it is applied to every bill of that customer.',
    questionUr: 'کسٹمر کو مستقل ڈسکاؤنٹ کیسے دوں؟',
    answerUr: 'اُدھار پیج سے کسٹمر کھولیں اور ڈسکاؤنٹ مقرر کریں — یہ اس کسٹمر کے ہر بل پر لگے گا۔',
    route: 'udhaar',
    keywords: ['discount', 'customer discount', 'off', 'dascount'],
  },
  {
    id: 'change_a_products_price',
    question: 'How do I change the price of a product?',
    answer: 'Inventory → the product → Edit. The sale price and the cost price are both there; the change is written to the stock card.',
    questionUr: 'سامنا کی قیمت کیسے بدلوں؟',
    answerUr: 'انوینٹری → سامنا → ایڈٹ۔ فروخت قیمت اور لاگت قیمت دونوں وہاں ہیں۔',
    route: 'inventory',
    keywords: ['price', 'change price', 'rate', 'qeemat'],
  },
  {
    id: 'count_the_stock',
    question: 'How do I count the stock?',
    answer: 'Audits → start an audit, count the pieces on the shelf and type the count. The difference becomes the stock adjustment.',
    questionUr: 'اسٹاک کا جائزہ کیسے لیں؟',
    answerUr: 'آڈٹس → آڈٹ شروع کریں، شیلف کے ٹکڑے گنیں اور گنتی لکھیں۔ فرق اسٹاک ایڈجسٹمنٹ بن جاتا ہے۔',
    route: 'audits',
    keywords: ['audit', 'count', 'stock count', 'stock'],
  },
  {
    id: 'print_a_receipt_again',
    question: 'How do I print a receipt again?',
    answer: 'The Cash Drawer and the Sales list both carry a reprint. The copy is stamped as a duplicate so the books stay honest.',
    questionUr: 'رسید دوبارہ کیسے پرن کروں؟',
    answerUr: 'کیش ڈراوَر اور سیلس لسٹ دونوں میں ری پرنٹ ہے۔ کاپی پر ڈپلیکیٹ کا مہر لگتا ہے۔',
    route: 'billing',
    keywords: ['reprint', 'receipt', 'duplicate', 'print'],
  },
  {
    id: 'sell_on_credit',
    question: 'How do I sell on credit (udhaar)?',
    answer: 'On the Billing screen pick the customer before saving the bill — the bill is then recorded against their udhaar balance.',
    questionUr: 'اُدھار پر بیچنا ہے تو کیسے کروں؟',
    answerUr: 'بلنگ اسکرین پر بل محفوظ کرنے سے پہلے کسٹمر منتخب کریں — بل اُن کے اُدھار بیلنس میں لکھا جائے گا۔',
    route: 'billing',
    keywords: ['udhaar', 'credit', 'khata', 'on credit'],
  },
  {
    id: 'add_a_user',
    question: 'How do I add a cashier or a manager?',
    answer: 'Admin → Users → Add user. The role decides what the person can see and do — a cashier never sees the profit.',
    questionUr: 'کیشیئر یا مینیجر کیسے شامل کروں؟',
    answerUr: 'ایڈمن → یوزرز → ایڈ یوزر۔ کردار بتاتا ہے کہ فرد کیا دیکھ اور کر سکتا ہے — کیشیئر منافع نہیں دیکھ سکتا۔',
    route: 'users',
    keywords: ['user', 'cashier', 'manager', 'staff', 'employee'],
  },
  {
    id: 'the_assistant_is_off',
    question: 'Why is the assistant not answering?',
    answer: 'The assistant is off by default. Admin → Assistant: turn it on, add the API key and choose the roles that may use it.',
    questionUr: 'اسسٹنٹ جواب کیوں نہیں دے رہا؟',
    answerUr: 'اسسٹنٹ پہلے سے بند ہوتا ہے۔ ایڈمن → اسسٹنٹ: آن کریں، API کلید لگائیں اور کردار منتخب کریں۔',
    route: 'admin',
    keywords: ['assistant', 'api key', 'off', 'enable'],
  },
  {
    id: 'take_a_backup',
    question: 'How do I keep a backup of the shop data?',
    answer: 'Admin → Backups. The app can also take a backup on its own — turn the automatic backup on in the same place.',
    questionUr: 'دکان کے ڈیٹا کا بیک اپ کیسے رکھوں؟',
    answerUr: 'ایڈمن → بیک اپس۔ ایپ خود بھی بیک اپ لے سکتی ہے — وہیں خودکار بیک اپ آن کریں۔',
    route: 'admin',
    keywords: ['backup', 'restore', 'copy', 'data'],
  },
];

/** The FAQ entry with that id (undefined when there is none). */
export function faqById(id: string): FaqEntry | undefined {
  return FAQ.find((f) => f.id === id);
}

/** The entry text in the language the shop reads. */
export function faqText(
  entry: FaqEntry,
  language: 'en' | 'ur' | 'roman' = 'en'
): { question: string; answer: string } {
  if (language === 'ur') return { question: entry.questionUr, answer: entry.answerUr };
  return { question: entry.question, answer: entry.answer };
}
