import { useEffect, useState } from 'react';

// v1 formula (placeholder, will be retuned): active_song_count * points,
// from each user's best fully-completed 30-question session. Shorter
// sessions still show up in that user's own History, just not here — see
// GET /api/leaderboard.
export default function LeaderboardPage() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then(setRows);
  }, []);

  if (!rows) return <p>Loading...</p>;

  return (
    <div className="leaderboard">
      <h2>Leaderboard</h2>
      <p className="song-meta">
        Best completed 30-question session, score = number of songs checked &times; points earned. Early formula —
        expect it to change.
      </p>
      {rows.length === 0 ? (
        <p>No one has completed a full 30-question session yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Score</th>
              <th># Songs</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.user_id}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{r.score}</td>
                <td>{r.active_song_count}</td>
                <td>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
