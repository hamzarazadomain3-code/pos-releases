import re
file_path = r"E:\\antigravty\\billing softwere\\pos-app\\src\\renderer\\src\\App.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("{{ zIndex: 9999 }}}\">", "{{ zIndex: 9999 }}\">")
content = content.replace("}}\">>", "}}\">")
content = content.replace("}}\">>/div>>", "}}\">/div>")
content = content.replace("}}\">>Installing update...\"/strong>>", "}}\">Installing update...\"/strong>")
content = content.replace(">Please wait while the app restarts", "Please wait while the app restarts")
content = content.replace("<style jsx{", "<style jsx {")
content = content.replace("`}}\">></style>", "`}\"></style>")
with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Fixed final block")