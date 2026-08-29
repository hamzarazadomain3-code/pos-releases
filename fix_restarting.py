import re
file_path = r"E:\\antigravty\\billing softwere\\pos-app\\src\\renderer\\src\\App.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("<div className=\"modal-overlay\" style={{ zIndex: 9999 }}}\">>", "<div className=\"modal-overlay\" style={{ zIndex: 9999 }}\">")
content = content.replace("<div className=\"modal\" style={{ textAlign: 'center', padding: '40px' }}}\">>", "<div className=\"modal\" style={{ textAlign: 'center', padding: '40px' }}\">")
content = content.replace("}}\">>/div>>", "}}\">/div>")
content = content.replace("}}\">>Installing update...\"/strong>>", "}}\">Installing update...\"/strong>")
content = content.replace("<style jsx{{`", "<style jsx{`")
content = content.replace("`}}\">></style>", "`}\"></style>")
with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Fixed restarting block")