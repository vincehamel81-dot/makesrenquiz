import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TrendChart from '../components/TrendChart';

export default function HistoryPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p>Loading...</p>;

  return (
    <div className="history">
      <h2>Accuracy trend</h2>
      <p className="song-meta">
        Want a fresh start? Reset your stats from <Link to="/profile">Profile</Link>.
      </p>
      <TrendChart daily={data.daily} />

      <h2>Score history</h2>
      {data.daily.length === 0 && <p>No attempts logged yet — play a session first.</p>}
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th># Songs</th>
            <th>Points</th>
            <th>Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {data.daily.map((d) => (
            <tr key={`${d.day}-${d.active_song_count}`}>
              <td>{d.day}</td>
              <td>{d.active_song_count ?? '—'}</td>
              <td>{d.points}</td>
              <td>
                {d.points}/{d.max_points} ({Math.round((100 * d.points) / d.max_points)}%)
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>By question type</h3>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Points</th>
            <th>Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {data.byType.map((t) => (
            <tr key={t.question_type}>
              <td>{t.question_type}</td>
              <td>{t.points}</td>
              <td>
                {t.points}/{t.max_points} ({Math.round((100 * t.points) / t.max_points)}%)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
