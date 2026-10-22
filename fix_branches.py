with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\Settings.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add branches loading in the useEffect
old_code = """window.api.receipt.getTemplates().then(setReceiptTemplates).catch(() => setReceiptTemplates([]));
    window.api.admin.settings.get('receipt_template').then((v) => {
      if (v) setSelectedTemplate(v);
    }).catch(() => undefined);"""

new_code = """window.api.receipt.getTemplates().then(setReceiptTemplates).catch(() => setReceiptTemplates([]));
    window.api.admin.settings.get('receipt_template').then((v) => {
      if (v) setSelectedTemplate(v);
    }).catch(() => undefined);
    window.api.branches.list().then(setBranches).catch(() => setBranches([]));"""

content = content.replace(old_code, new_code)

with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\Settings.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed')