# Read the new history modal content
with open(r"E:\antigravty\billing softwere\pos-app\history_modal_new.tsx", "r", encoding="utf-8") as f:
    new_modal = f.read()

# Read the current Billing.tsx
with open(r"E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\Billing.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Find the old history modal block - it starts with "{history && (" and ends before "{/* Below cost confirmation modal */}"
start_marker = "{history && ("
start_idx = content.find(start_marker)

# Find the end - look for "{/* Below cost confirmation modal */}"
end_marker = "{/* Below cost confirmation modal */}"
end_idx = content.find(end_marker)

print(f"Start index: {start_idx}")
print(f"End index: {end_idx}")

if start_idx != -1 and end_idx != -1:
    # Replace the old modal with the new one
    new_content = content[:start_idx] + new_modal + "\n      " + content[end_idx:]
    
    with open(r"E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\Billing.tsx", "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Replaced history modal successfully")
else:
    print("Could not find markers")
    if start_idx == -1:
        print("Start marker not found")
    if end_idx == -1:
        print("End marker not found")