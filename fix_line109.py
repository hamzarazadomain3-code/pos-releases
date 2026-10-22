with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\components\FirstRunWizard.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix line 109 - replace the mixed quote
content = content.replace("      });'", "      });")

with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\components\FirstRunWizard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed')