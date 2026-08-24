import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import QuizPage from './pages/QuizPage';
import HistoryPage from './pages/HistoryPage';
import SongKnowledgePage from './pages/SongKnowledgePage';
import LookupPage from './pages/LookupPage';
import SongsListPage from './pages/SongsListPage';
import SongDetailPage from './pages/SongDetailPage';
import ProfilePage from './pages/ProfilePage';
import LeaderboardPage from './pages/LeaderboardPage';
import './App.css';

const TABS = [
  { to: '/', label: 'Quiz', end: true },
  { to: '/songs', label: 'Songs' },
  { to: '/history', label: 'History' },
  { to: '/song-knowledge', label: 'Song Knowledge' },
  { to: '/lookup', label: 'Lyric lookup' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/profile', label: 'Profile' },
];

export default function App() {
  const [songTitles, setSongTitles] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch('/api/songs')
      .then((r) => r.json())
      .then((songs) => setSongTitles(songs.map((s) => s.title)));
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <button className="hamburger" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu">
          ☰
        </button>
        <nav className={`tabs${menuOpen ? ' open' : ''}`}>
          {TABS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <main>
        <Routes>
          <Route path="/" element={<QuizPage songTitles={songTitles} />} />
          <Route path="/songs" element={<SongsListPage />} />
          <Route path="/songs/:slug" element={<SongDetailPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/song-knowledge" element={<SongKnowledgePage />} />
          <Route path="/lookup" element={<LookupPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </main>
    </div>
  );
}
