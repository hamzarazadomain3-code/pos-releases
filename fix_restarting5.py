import re
file_path = r"E:\\antigravty\\billing softwere\\pos-app\\src\\renderer\\src\\App.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("{{ zIndex: 9999 }}}">", "{{ zIndex: 9999 }}">")
content = content.replace("{{ textAlign: 'center', padding: '40px' }}}">", "{{ textAlign: 'center', padding: '40px' }}">")
content = content.replace("}}">>/div>", "}}">/div>")
content = content.replace("}}">>", "}}">")
content = content.replace("`}}"></style>", "`}"></style>")
with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Fixed all block")