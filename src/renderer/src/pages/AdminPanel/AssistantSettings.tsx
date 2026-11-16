import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantActivityRow, AssistantRole, AssistantSettingsView } from '../../../../shared/assistant/types';
import { ASSISTANT_DATA_LEVELS, ASSISTANT_LANGUAGES, ASSISTANT_ROLES } from '../../../../shared/assistant/settings';
import { buildToolRegistry } from '../../../../shared/assistant/tools';
import { privacyRows, privacySummary } from '../../../../shared/assistant/privacy';
import { clearHistory } from '../../../../shared/assistant/history';
import { formatTimestamp } from '../../utils/dateUtils';

/**
 * Settings → Assistant (owner only).
 *
 * Everything here is owner-only: the Admin panel itself is owner-only, and the
 * main process refuses the write for anyone else.
 *
 * The API key field is masked: the value that was stored is never sent to the
 * renderer — only whether a key exists and its last four characters.
 */
export default function AssistantSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AssistantSettingsView | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activity, setActivity] = useState<AssistantActivityRow[]>([]);

  // The privacy table is GENERATED from the tool registry — it can never
  // drift from what the assistant may really do.
  const privacy = useMemo(() => {
    const rows = privacyRows(buildToolRegistry());
    return { rows, summary: privacySummary(rows) };
  }, []);

  const load = useCallback(async () => {
    try {
      const view = await window.api.assistant.getSettings();
      setSettings(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const rows = await window.api.assistant.activity();
      setActivity(rows);
    } catch {
      setActivity([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadActivity();
  }, [load, loadActivity]);

  const save = async (patch: Partial<AssistantSettingsView>) => {
    setBusy(true);
    setError(null);
    try {
      const view = await window.api.assistant.saveSettings(patch as any);
      setSettings(view);
      setNotice(t('settings.assistant.saved'));
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.assistant.setKey(keyInput);
      setKeyInput('');
      await load();
      if (res.message) setNotice(res.message);
      else setNotice(t('settings.assistant.saved'));
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setError(null);
    try {
      const res = await window.api.assistant.testConnection();
      if (res.ok) setNotice(res.message);
      else setError(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.api.assistant.setKey('');
      await load();
      setNotice(t('settings.assistant.keyCleared'));
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleRole = (role: AssistantRole) => {
    if (!settings) return;
    const roles = settings.roles.includes(role)
      ? settings.roles.filter((r) => r !== role)
      : [...settings.roles, role];
    if (roles.length === 0) {
      setError(t('settings.assistant.atLeastOneRole'));
      return;
    }
    void save({ roles });
  };

  const clearLocalHistory = async () => {
    try {
      const user = await window.api.auth.currentUser();
      clearHistory(user?.id ?? 0);
      setNotice(t('settings.assistant.historyCleared'));
      setTimeout(() => setNotice(null), 2500);
    } catch {
      setError(t('settings.assistant.historyClearFailed'));
    }
  };

  if (!settings) {
    return <div className="admin-sub-page muted">{t('settings.assistant.loading')}</div>;
  }

  const keySourceServer = settings.keySource === 'server';

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>{t('settings.assistant.title')}</h2>
        <div className="admin-sub-actions">
          <span className="muted small">{t('settings.assistant.ownerOnly')}</span>
        </div>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      {error && <div className="notice error" onClick={() => setError(null)}>{error}</div>}

      {/* ── the kill switch ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>{t('settings.assistant.enable')}</h3>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busy}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />
            <span>{settings.enabled ? t('settings.assistant.on') : t('settings.assistant.off')}</span>
          </label>
        </div>
        <p className="muted small">{t('settings.assistant.enableHint')}</p>
      </div>

      {/* ── the key ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>{t('settings.assistant.apiKey')}</h3>
        </div>
        <p className="muted small">{t('settings.assistant.apiKeyHint')}</p>
        {keySourceServer ? (
          <p className="muted small">{t('settings.assistant.webKeyNote')}</p>
        ) : (
          <>
            <div className="row-btns" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="password"
                className="input"
                style={{ minWidth: 280 }}
                placeholder={t('settings.assistant.apiKeyPlaceholder')}
                value={keyInput}
                autoComplete="off"
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <button className="btn btn-sm" disabled={busy || !keyInput} onClick={() => void saveKey()}>
                {t('settings.assistant.saveKey')}
              </button>
              <button className="btn btn-sm" disabled={busy || !settings.keySet} onClick={() => void clearKey()}>
                {t('settings.assistant.clearKey')}
              </button>
              <button className="btn btn-sm btn-primary" disabled={testing || !settings.keySet} onClick={() => void testConnection()}>
                {testing ? t('settings.assistant.testing') : t('settings.assistant.testConnection')}
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {settings.keySet ? t('settings.assistant.keyStored', { hint: settings.keyHint }) : t('settings.assistant.keyMissing')}
            </p>
          </>
        )}
      </div>

      {/* ── the model, the budget, the roles, the data level ────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>{t('settings.assistant.behaviour')}</h3>
        </div>

        <div className="form-row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 240 }}>
            <label>{t('settings.assistant.model')}</label>
            <input
              value={settings.model}
              disabled={busy}
              placeholder={t('settings.assistant.modelPlaceholder')}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              onBlur={() => void save({ model: settings.model })}
            />
            <div className="muted small">{t('settings.assistant.modelHint')}</div>
          </div>

          <div className="form-group" style={{ minWidth: 200 }}>
            <label>{t('settings.assistant.budget')}</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={settings.dailyBudgetUsd}
              disabled={busy}
              onChange={(e) => setSettings({ ...settings, dailyBudgetUsd: Number(e.target.value) })}
              onBlur={() => void save({ dailyBudgetUsd: settings.dailyBudgetUsd })}
            />
            <div className="muted small">{t('settings.assistant.budgetHint')}</div>
          </div>

          <div className="form-group" style={{ minWidth: 200 }}>
            <label>{t('settings.assistant.language')}</label>
            <select
              value={settings.language}
              disabled={busy}
              onChange={(e) => void save({ language: e.target.value as AssistantSettingsView['language'] })}
            >
              {ASSISTANT_LANGUAGES.map((l) => (
                <option key={l} value={l}>{t(`settings.assistant.language_${l}`)}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ minWidth: 240 }}>
            <label>{t('settings.assistant.dataLevel')}</label>
            <select
              value={settings.dataLevel}
              disabled={busy}
              onChange={(e) => void save({ dataLevel: e.target.value as AssistantSettingsView['dataLevel'] })}
            >
              {ASSISTANT_DATA_LEVELS.map((l) => (
                <option key={l} value={l}>{t(`settings.assistant.dataLevel_${l}`)}</option>
              ))}
            </select>
            <div className="muted small">{t(`settings.assistant.dataLevelExplain_${settings.dataLevel}`)}</div>
          </div>
        </div>

        <div className="form-group">
          <label>{t('settings.assistant.roles')}</label>
          <div className="row-btns" style={{ gap: 12, flexWrap: 'wrap' }}>
            {ASSISTANT_ROLES.map((role) => (
              <label key={role} className="field-inline">
                <input
                  type="checkbox"
                  checked={settings.roles.includes(role)}
                  disabled={busy}
                  onChange={() => toggleRole(role)}
                />
                <span>{t(`settings.assistant.role_${role}`)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="field-inline">
            <input
              type="checkbox"
              checked={settings.actionsEnabled}
              disabled={busy}
              onChange={(e) => void save({ actionsEnabled: e.target.checked })}
            />
            <span>{t('settings.assistant.actions')}</span>
          </label>
          <div className="muted small">{t('settings.assistant.actionsHint')}</div>
        </div>

        <div className="form-group">
          <label className="field-inline">
            <input
              type="checkbox"
              checked={settings.proactiveEnabled}
              disabled={busy}
              onChange={(e) => void save({ proactiveEnabled: e.target.checked })}
            />
            <span>{t('settings.assistant.proactive')}</span>
          </label>
          <div className="muted small">{t('settings.assistant.proactiveHint')}</div>
        </div>
      </div>

      {/* ── the privacy + the cost (what the assistant may do) ───────────── */}
      <div className="card">
        <div className="card-head">
          <h3>{t('settings.assistant.privacyTitle')}</h3>
        </div>
        <p className="muted small">{t('settings.assistant.privacyHint')}</p>

        <div className="form-row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 200 }}>
            <label>{t('settings.assistant.spentToday')}</label>
            <div className="small">
              ${(settings.spendTodayUsd ?? 0).toFixed(4)} / ${(settings.dailyBudgetUsd ?? 0).toFixed(2)}
            </div>
            <div className="muted small">
              {t('settings.assistant.callsToday', { count: settings.callsToday ?? 0 })}
            </div>
          </div>
          <div className="form-group" style={{ minWidth: 200 }}>
            <label>{t('settings.assistant.dataLevel')}</label>
            <div className="small">{t(`settings.assistant.dataLevel_${settings.dataLevel}`)}</div>
            <div className="muted small">{t(`settings.assistant.dataLevelExplain_${settings.dataLevel}`)}</div>
          </div>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label>{t('settings.assistant.toolsCount')}</label>
            <div className="small">
              {t('settings.assistant.toolsSummary', {
                total: privacy.summary.total,
                read: privacy.summary.read,
                write: privacy.summary.write,
                dangerous: privacy.summary.dangerous,
              })}
            </div>
          </div>
        </div>

        <div className="table-wrap" style={{ maxHeight: 320, marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('settings.assistant.tool')}</th>
                <th>{t('settings.assistant.toolDoes')}</th>
                <th>{t('settings.assistant.toolRisk')}</th>
                <th>{t('settings.assistant.toolRoles')}</th>
              </tr>
            </thead>
            <tbody>
              {privacy.rows.map((row) => (
                <tr key={row.name}>
                  <td className="small">{row.name}</td>
                  <td className="muted small">{row.description}</td>
                  <td className="small">{t(`settings.assistant.risk_${row.risk}`)}</td>
                  <td className="muted small">
                    {row.roles.map((role) => t(`settings.assistant.role_${role}`)).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="muted small" style={{ marginTop: 8 }}>
          {t('settings.assistant.optOutHint')}
        </p>
      </div>

      {/* ── the history + the activity ──────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>{t('settings.assistant.activity')}</h3>
          <div className="admin-sub-actions">
            <button className="btn btn-sm" onClick={() => void clearLocalHistory()}>
              {t('settings.assistant.clearHistory')}
            </button>
            <button className="btn btn-sm" onClick={() => void loadActivity()}>
              {t('settings.assistant.refresh')}
            </button>
          </div>
        </div>
        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('settings.assistant.when')}</th>
                <th>{t('settings.assistant.who')}</th>
                <th>{t('settings.assistant.what')}</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((row) => (
                <tr key={row.id}>
                  <td className="muted small">{formatTimestamp(row.created_at)}</td>
                  <td>{row.username ?? '—'}</td>
                  <td className="muted small">{row.details ?? row.action}</td>
                </tr>
              ))}
              {activity.length === 0 && (
                <tr><td colSpan={3} className="muted center">{t('settings.assistant.noActivity')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
