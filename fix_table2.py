import re

with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\ReceiptDesigner.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the map callback - replace the broken structure with proper <> fragment
old_block = '''                        {expandedId === b.id && selected && (
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
                        )
                        return (
                          <>
                            <tr
                              onClick={() => { setSelectedId(b.id); setExpandedId(expandedId === b.id ? null : b.id); }}
                              style={{ cursor: "pointer", background: selectedId === b.id ? "rgba(220,53,69,0.08)" : (expandedId === b.id ? "#f8f9fa" : undefined) }}
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
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
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
                                  title={expandedId === b.id ? "Collapse" : "Edit"}
                                >
                                  {expandedId === b.id ? "Collapse" : "Edit"}
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
                                    style={{ color: "#b91c1c" }}
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
                                  <div style={{ padding: "12px", background: "#f8f9fa", borderTop: "1px solid #e9ecef" }}>
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
                        );
                      })}\n                  </tbody>'''

new_block = '''                        {expandedId === b.id && selected && (
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
                    );
                  })}\n                  </tbody>'''

content = content.replace(old_block, new_block)

with open(r'E:\antigravty\billing softwere\pos-app\src\renderer\src\pages\ReceiptDesigner.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed')