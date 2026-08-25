import { useEffect, useState } from 'react';

// v1 formula (placeholder, will be retuned): active_song_count * points,
// from each user's best fully-completed session. Shorter sessions still
// show up in that user's own History, just not here — see GET /api/leaderboard,
// which is also where session_length actually comes from (not hardcoded here).
export default function LeaderboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p>Loading...</p>;
  const { session_length, limit, entries } = data;

  return (
    <div className="leaderboard">
      <h2>Leaderboard</h2>
      <p className="song-meta">
        Top {limit} completed {session_length}-question sessions, score = (number of songs checked &divide; 2)
        &times; points earned.
      </p>
      {entries.length === 0 ? (
        <p>No one has completed a full {session_length}-question session yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th># Songs</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((r, i) => (
              <tr key={r.user_id}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{r.active_song_count}</td>
                <td>{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
