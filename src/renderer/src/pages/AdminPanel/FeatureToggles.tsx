import { useEffect, useState } from 'react';
import type { FeatureToggleRow } from '../../../../shared/types';
import { formatDateAdmin } from '../../utils/dateUtils';

export default function FeatureToggles() {
  const [features, setFeatures] = useState<FeatureToggleRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const f = await window.api.admin.features.getAll();
      setFeatures(f);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (name: string) => {
    setBusy(name);
    setNotice(null);
    try {
      await window.api.admin.features.toggle(name);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const formatName = (name: string) =>
    name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>Feature Toggles</h2>
        <p className="muted small">Enable or disable system features. Changes take effect immediately.</p>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      <div className="feature-grid">
        {features.map((f) => (
          <div key={f.feature_name} className={`feature-card ${f.is_enabled ? 'enabled' : 'disabled'}`}>
            <div className="feature-card-header">
              <span className="feature-name">{formatName(f.feature_name)}</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={f.is_enabled === 1}
                  disabled={busy === f.feature_name}
                  onChange={() => toggle(f.feature_name)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            {f.description && <p className="feature-desc muted small">{f.description}</p>}
            <div className="feature-meta muted small">
              {f.updated_at && <span>Updated: {formatDateAdmin(f.updated_at)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
