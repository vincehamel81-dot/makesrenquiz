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
import RequireAuth from './components/RequireAuth';
import GoogleSignInButton from './components/GoogleSignInButton';
import ThemeToggle from './components/ThemeToggle';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ThemeProvider } from './lib/ThemeContext';
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

function AccountControl() {
  const { user, checking, logout } = useAuth();
  if (checking) return null;
  if (!user) return <GoogleSignInButton />;
  return (
    <div className="account-control">
      <span>{user.display_name}</span>
      <button className="btn-secondary" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}

export default function App() {
  const [songTitles, setSongTitles] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch('/api/songs')
      .then((r) => r.json())
      .then((songs) => setSongTitles(songs.map((s) => s.title)));
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
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
          <div className="topbar-utility">
            <ThemeToggle />
            <AccountControl />
          </div>
        </div>
        <main>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <QuizPage songTitles={songTitles} />
                </RequireAuth>
              }
            />
            <Route path="/songs" element={<SongsListPage />} />
            <Route path="/songs/:slug" element={<SongDetailPage />} />
            <Route
              path="/history"
              element={
                <RequireAuth>
                  <HistoryPage />
                </RequireAuth>
              }
            />
            <Route
              path="/song-knowledge"
              element={
                <RequireAuth>
                  <SongKnowledgePage />
                </RequireAuth>
              }
            />
            <Route path="/lookup" element={<LookupPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
          </Routes>
        </main>
      </div>
      </AuthProvider>
    </ThemeProvider>
  );
}
