import re
file_path = r\"E:\\antigravty\\billing softwere\\pos-app\\src\\renderer\\src\\App.tsx\"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines()
new_lines = []
inside_update = False
for i, line in enumerate(lines):
    if 'status.state === 'downloading'' in line and 'return null;' in \"\".join(lines[i:i+3]):
        new_lines.append(line)
        new_lines.append('  if (status.state === \'restarting\') {')
        new_lines.append('    return (')
        new_lines.append('      <div className=\"modal-overlay\" style={{zIndex: 9999}}>')
        new_lines.append('        <div className=\"modal\" style={{textAlign: \'center\', padding: \'40px\' }}>')
        new_lines.append('          <div className=\"spinner\" style={{ margin: \'0 auto 16px\', width: \'40px\', height: \'40px\', border: \'4px solid #e0e0e0\', borderTopColor: \'#3b82f6\', borderRadius: \'50%\', animation: \'spin 1s linear infinite\' }}></div>')
        new_lines.append('         <strong style={{ fontSize: \'18px\', display: \'block\', marginBottom: \'8px\' }}>Installing update...</strong>')
        new_lines.append('         <span className=\"muted small\">Please wait while the app restarts</span>')
        new_lines.append('         <style jsx>{ `keyframes spin { to { transform: rotate(360deg); } }`</style>')
        new_lines.append('        </div>')
        new_lines.append('      </div>')
        new_lines.append('    );'
        new_lines.append('    return null;')
        new_lines.append('')
        inside_update = True
    elif inside_update and 'return null;' in line:
        inside_update = False
    else:
        new_lines.append(line)
new_content = \"\n\".join(new_lines)
with open(file_path, 'w', encoding='utf-8') yp:
    y.write(new_content)
print('Successfully updated App.tsx')