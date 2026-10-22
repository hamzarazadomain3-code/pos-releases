import re

with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\ReceiptDesigner.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# The map callback has duplicate content. Let me replace the entire map callback with a clean version.
# Find the map callback
start_marker = '{design.sections.map((b, i) => {'
end_marker = '                  </tbody>'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker, content.find(start_marker))

if start_idx == -1 or end_idx == -1:
    print("Markers not found")
else:
    # The map callback starts at start_idx, ends at end_idx + len('                  </tbody>')
    old_section = content[start_idx:end_idx + 18]
    
    new_section = '''{design.sections.map((b, i) => (
                      <>
                        <tr
                          onClick={() => { setSelectedId(b.id); setExpandedId(expandedId === b.id ? null : b.id); }}
                          style={{ cursor: 'pointer', background: selectedId === b.id ? 'rgba(220,53,69,0.08)' : (expandedId === b.id ? '#f8f9fa' : undefined) }}
                        >
                          <td style={{ width: 30 }}>
                            <input
                              type="checkbox"
                              checked={b.enabled}
                              onClick={(e) => { e.stopPropagation(); updateBlock(b.id, { enabled: e.target.checked }); }}
                              title="Show / hide"
                              disabled={!canEdit}
                            />
                          </td>
                          <td>
                            <span style={{ fontWeight: 500 }}>{BLOCK_LABELS[b.type]}</span>
                            {b.text && <span className="muted small" style={{ marginLeft: 8 }}> — {b.text.slice(0, 50)}</span>}
                            {expandedId === b.id && <span className="muted small" style={{ marginLeft: 8 }}>▼</span>}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              className="btn btn-sm"
                              disabled={i === 0 || !canEdit}
                              onClick={(e) => { e.stopPropagation(); move(b.id, -1); }}
                              title="Move up"
                            >
                              ↑
                            </button>{' '}
                            <button
                              className="btn btn-sm"
                              disabled={i === design.sections.length - 1 || !canEdit}
                              onClick={(e) => { e.stopPropagation(); move(b.id, 1); }}
                              title="Move down"
                            >
                              ↓
                            </button>{' '}
                            <button
                              className="btn btn-sm"
                              disabled={!canEdit}
                              onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === b.id ? null : b.id); setSelectedId(b.id); }}
                              title={expandedId === b.id ? 'Collapse' : 'Edit'}
                            >
                              {expandedId === b.id ? 'Collapse' : 'Edit'}
                            </button>{' '}
                            <button
                              className="btn btn-sm"
                              disabled={!canEdit}
                              onClick={(e) => { e.stopPropagation(); duplicateBlock(b.id); }}
                              title="Duplicate"
                            >
                              ↻
                            </button>{' '}
                            {CUSTOM_BLOCK_TYPES.includes(b.type) ? (
                              <button
                                className="btn btn-sm"
                                style={{ color: '#b91c1c' }}
                                onClick={(e) => { e.stopPropagation(); removeBlock(b.id); if (expandedId === b.id) setExpandedId(null); }}
                                title="Remove"
                                disabled={!canEdit}
                              >
                                ✕
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {expandedId === b.id && selected && (
                          <tr>
                            <td colSpan={3} style={{ padding: 0 }}>
                              <div style={{ padding: '12px', background: '#f8f9fa', borderTop: '1px solid #e9ecef' }}>
                                <BlockProperties
                                  block={selected}
                                  canEdit={canEdit}
                                  onPatch={(p) => updateBlock(selected.id, p)}
                                  onStyle={(p) => updateStyle(selected.id, p)}
                                  shopSettings={shopSettings}
                                  onClose={() => setExpandedId(null)}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>'''

new_content = content[:start_idx] + new_section + content[end_idx + 18:]

with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\ReceiptDesigner.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Fixed')