# ShopKeeper POS v1.5.7 — استعمال کی رہنمائی

## 🆕 نئی خصوصیات

### 1️⃣ Decimal Quantity (Gram/Kilogram میں)
- Billing میں quantity میں 0.78 ڈالیں
- Price خودکار calculate ہوگی
- مثال: 0.78 Kg چاول @ Rs 1000/Kg = Rs 780
- Gram mode میں بھی decimal درست ہوگا (مثلاً 250.5 گرام)

### 2️⃣ Weighing Scale Integration (BayLan RLS1100)
- Scale پر وزن کریں (مثلاً 234g)
- Scale کا label print کریں (barcode: 2PPPPPPWWWWWC)
- POS میں barcode scan کریں
- Weight اور price خودکار آ جائیں گے
- Receipt پر "234 gram | Rs …" دکھے گا
- **نوٹ**: Scale کی PLU کو پہلے product کی barcode/SKU میں set کریں

### 3️⃣ Dashboard (📊)
- روزانہ کی فروخت دیکھیں (Today's Sales, Total Bills, Avg Bill)
- اہم products کے bar/pie charts
- ہر گھنٹے کی فروخت کا line chart
- ہر 1 منٹ بعد خودکار refresh

### 4️⃣ Barcode Printer (🏷️)
- Sidebar سے "Barcode Labels" کھولیں
- Products select کریں (یا Select All)
- Label size چنیں (38×25mm thermal وغیرہ)
- "Print" دبائیں — 38×25mm stickers print ہوں گے
- Printed barcode scanner سے scan کریں

### 5️⃣ WhatsApp Receipts (اختیاری)
- Settings → WhatsApp Receipt Alerts کھولیں
- QR code کو اپنے WhatsApp (Menu → Linked Devices) سے scan کریں
- "WhatsApp Connected" ہو جائے گا
- Sale complete کرنے کے بعد success modal میں "WhatsApp Receipt" button دبائیں
- Customer کو WhatsApp پر receipt ملے گی
- **نوٹ**: پہلی بار QR صرف اس وقت دکھتا ہے جب app شروع ہو؛ اگر QR نہ ملے تو app دوبارہ کھولیں

---

## 🛠️ معاونت
- کوئی مسئلہ ہو تو اپنے سپلائر یا ڈویلپر سے رابطہ کریں
- ڈیٹا ہمیشہ محفوظ رہتا ہے (بیک اپ خودکار روزانہ)

*ShopKeeper POS — Al Baghdad Sweets & Bakers کے لیے تیار کردہ*