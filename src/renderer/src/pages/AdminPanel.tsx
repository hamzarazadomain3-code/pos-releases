import { useState } from 'react';
import ShortcutKeys from './AdminPanel/ShortcutKeys';
import FeatureToggles from './AdminPanel/FeatureToggles';
import RolesPermissions from './AdminPanel/RolesPermissions';
import SystemSettings from './AdminPanel/SystemSettings';
import UserManagement from './AdminPanel/UserManagement';
import ActivityLog from './AdminPanel/ActivityLog';
import AdminReports from './AdminPanel/AdminReports';

type AdminTab = 'shortcuts' | 'features' | 'roles' | 'settings' | 'users' | 'activity' | 'reports';

const TABS: { key: AdminTab; label: string; icon: string }[] = [
  { key: 'settings', label: 'System Settings', icon: '' },
  { key: 'shortcuts', label: 'Shortcuts', icon: '' },
  { key: 'features', label: 'Feature Toggles', icon: '' },
  { key: 'roles', label: 'Roles & Permissions', icon: '' },
  { key: 'users', label: 'User Management', icon: '' },
  { key: 'activity', label: 'Activity Log', icon: '' },
  { key: 'reports', label: 'System Reports', icon: '' },
];

export default function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>('settings');

  const renderContent = () => {
    switch (tab) {
      case 'shortcuts': return <ShortcutKeys />;
      case 'features': return <FeatureToggles />;
      case 'roles': return <RolesPermissions />;
      case 'settings': return <SystemSettings />;
      case 'users': return <UserManagement />;
      case 'activity': return <ActivityLog />;
      case 'reports': return <AdminReports />;
      default: return <SystemSettings />;
    }
  };

  return (
    <div className="page admin-panel">
      <div className="page-header">
        <h1>Admin Control Panel</h1>
        <span className="muted small" style={{ marginLeft: 8 }}>Owner access only</span>
      </div>

      <div className="admin-layout">
        <nav className="admin-sidebar">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`admin-tab-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <main className="admin-content">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
