import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from './common';
import { PlayerBar } from '../player/PlayerBar';

const NAV = [
  { group: 'Biblioteka', links: [
    { to: '/', icon: '▦', label: 'Wszystko', end: true },
    { to: '/ebooks', icon: '📖', label: 'E-booki' },
    { to: '/audiobooks', icon: '🎧', label: 'Audiobooki' },
    { to: '/reading', icon: '▶', label: 'W trakcie' },
  ]},
  { group: 'Przeglądaj', links: [
    { to: '/authors', icon: '✍', label: 'Autorzy' },
    { to: '/series', icon: '≣', label: 'Serie' },
    { to: '/collections', icon: '📚', label: 'Kolekcje' },
  ]},
];

export function Layout() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { data: stats } = useAsync(() => api.stats(), []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/?search=${encodeURIComponent(q)}`);
    setOpen(false);
  };

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand"><span className="logo">📚</span> Bibliotekarz</div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="icon">{l.icon}</span> {l.label}
                {l.to === '/ebooks' && stats && <span className="count">{stats.ebooks}</span>}
                {l.to === '/audiobooks' && stats && <span className="count">{stats.audiobooks}</span>}
                {l.to === '/reading' && stats && stats.reading > 0 && <span className="count">{stats.reading}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <span className="icon">⚙</span> Ustawienia
        </NavLink>
      </aside>

      <div className="main">
        <div className="topbar">
          <button className="mobile-nav-toggle" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>☰</button>
          <form className="search-box" onSubmit={submitSearch}>
            <span className="search-icon">🔍</span>
            <input
              placeholder="Szukaj po tytule, autorze, serii, lektorze…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => api.scan().catch(() => {})} title="Skanuj bibliotekę">↻ Skanuj</button>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>

      <PlayerBar />
    </div>
  );
}
