import { useAuth } from '../lib/AuthContext';

// Gates Quiz/History/Song Knowledge/Profile — Songs browsing, Lyric lookup,
// and Leaderboard stay open to anyone (see App.jsx's route list). The
// sign-in button itself lives once in the nav's AccountControl, not here.
export default function RequireAuth({ children }) {
  const { user, checking } = useAuth();

  if (checking) return <p>Loading...</p>;
  if (!user) {
    return (
      <div className="auth-gate">
        <p>Sign in to use this — your quiz history, ratings, and checklist all live under your account.</p>
      </div>
    );
  }
  return children;
}
