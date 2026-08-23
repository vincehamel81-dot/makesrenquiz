import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import QuizPage from './pages/QuizPage';
import HistoryPage from './pages/HistoryPage';
import SongKnowledgePage from './pages/SongKnowledgePage';
import LookupPage from './pages/LookupPage';
import SongsListPage from './pages/SongsListPage';
import SongDetailPage from './pages/SongDetailPage';
import './App.css';

const TABS = [
  { to: '/', label: 'Quiz', end: true },
  { to: '/songs', label: 'Songs' },
  { to: '/history', label: 'History' },
  { to: '/song-knowledge', label: 'Song Knowledge' },
  { to: '/lookup', label: 'Lyric lookup' },
];

export default function App() {
  const [songTitles, setSongTitles] = useState([]);

  useEffect(() => {
    fetch('/api/songs')
      .then((r) => r.json())
      .then((songs) => setSongTitles(songs.map((s) => s.title)));
  }, []);

  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<QuizPage songTitles={songTitles} />} />
          <Route path="/songs" element={<SongsListPage />} />
          <Route path="/songs/:slug" element={<SongDetailPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/song-knowledge" element={<SongKnowledgePage />} />
          <Route path="/lookup" element={<LookupPage />} />
        </Routes>
      </main>
    </div>
  );
}
