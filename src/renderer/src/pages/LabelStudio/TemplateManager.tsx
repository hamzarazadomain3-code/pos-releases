import { useState, useEffect } from 'react';
import { KeyboardInput } from '@components/KeyboardInput';
import { Modal } from '@components/Modal';
import type { LabelTemplate } from './types';
import { LabelThumbnail } from './LabelThumbnail';

interface Props {
  templates: LabelTemplate[];
  builtinTemplates: LabelTemplate[];
  activeTemplateId: string;
  setActiveTemplateId: (id: string) => void;
  deleteTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => void;
  exportTemplate: (id: string) => void;
  importTemplate: (file: File) => void;
}

export function TemplateManager({
  templates,
  builtinTemplates,
  activeTemplateId,
  setActiveTemplateId,
  deleteTemplate,
  duplicateTemplate,
  exportTemplate,
  importTemplate,
}: Props) {
  const [search, setSearch] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);

  const allTemplates = [...builtinTemplates, ...templates];
  const filtered = allTemplates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search templates…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '200px', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
        />
        <input type="file" accept=".json" onChange={e => e.target.files?.[0] && importTemplate(e.target.files![0])} style={{ display: 'none' }} id="tmpl-import" />
        <button className="btn" onClick={() => document.getElementById('tmpl-import')?.click()}>Import JSON</button>
      </div>

      <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Preview</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Size</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Layout</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Type</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Elements</th>
              <th style={{ textAlign: 'center', padding: '8px', width: '160px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(tpl => (
              <tr key={tpl.id} style={{ borderBottom: '1px solid #f1f1f1', background: activeTemplateId === tpl.id ? '#eff6ff' : undefined }}>
                <td style={{ padding: '8px' }}>
                  <LabelThumbnail template={tpl} width={72} />
                </td>
                <td style={{ padding: '8px', fontWeight: 500 }}>{tpl.name}</td>
                <td style={{ padding: '8px' }}>
                  {typeof tpl.size === 'string' ? tpl.size : `${tpl.size.w}×${tpl.size.h}mm`}
                </td>
                <td style={{ padding: '8px' }}>{tpl.layout}</td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '10px',
                    background: tpl.id.startsWith('builtin-') ? '#e0e7ff' : '#dcfce7',
                    color: tpl.id.startsWith('builtin-') ? '#3730a3' : '#166534'
                  }}>
                    {tpl.id.startsWith('builtin-') ? 'Built-in' : 'Custom'}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>{tpl.elements.length}</td>
                <td style={{ padding: '8px', display: 'flex', gap: '4px' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => setActiveTemplateId(tpl.id)}
                    disabled={activeTemplateId === tpl.id}
                    title="Use this template"
                  >
                    Use
                  </button>
                  {!tpl.id.startsWith('builtin-') && (
                    <>
                      <button className="btn btn-sm" onClick={() => duplicateTemplate(tpl.id)} title="Duplicate">⎘</button>
                      <button className="btn btn-sm" onClick={() => exportTemplate(tpl.id)} title="Export JSON">⤓</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteTemplate(tpl.id)} title="Delete">🗑</button>
                    </>
                  )}
                  {tpl.id.startsWith('builtin-') && (
                    <button className="btn btn-sm" onClick={() => duplicateTemplate(tpl.id)} title="Customize">✎ Customize</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="muted center pad">No templates found</div>}
      </div>
    </div>
  );
}