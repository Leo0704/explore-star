import { NavLink, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import RunHistory from './pages/RunHistory';
import Leads from './pages/Leads';
import Insights from './pages/Insights';
import Events from './pages/Events';
import Config from './pages/Config';

const NAV = [
  { path: '/',         label: '仪表盘',  icon: '◈' },
  { path: '/runs',     label: 'Run 历史', icon: '⟳' },
  { path: '/leads',    label: 'Lead 漏斗', icon: '▼' },
  { path: '/insights', label: '反馈洞察', icon: '◎' },
  { path: '/events',   label: '事件流',   icon: '⌁' },
  { path: '/config',   label: '配置查看', icon: '⚙' },
];

export default function App() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">✦ 探星</div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <NavLink
              key={n.path}
              to={n.path}
              end={n.path === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
          explore-star v0.1.0
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/runs"     element={<RunHistory />} />
          <Route path="/leads"    element={<Leads />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/events"   element={<Events />} />
          <Route path="/config"   element={<Config />} />
        </Routes>
      </main>
    </div>
  );
}
