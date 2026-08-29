import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TrendChart from '../components/TrendChart';
import ClipPlayer from '../components/ClipPlayer';

export default function HistoryPage() {
  const [data, setData] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null); // `${day}-${active_song_count}`
  const [attemptsByDay, setAttemptsByDay] = useState({});

  useEffect(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then(setData);
  }, []);

  async function toggleDrilldown(d) {
    const key = `${d.day}-${d.active_song_count}`;
    if (expandedDay === key) {
      setExpandedDay(null);
      return;
    }
    setExpandedDay(key);
    if (!attemptsByDay[key]) {
      const params = new URLSearchParams({ day: d.day });
      if (d.active_song_count != null) params.set('active_song_count', d.active_song_count);
      const attempts = await fetch(`/api/history/attempts?${params}`).then((r) => r.json());
      setAttemptsByDay((prev) => ({ ...prev, [key]: attempts }));
    }
  }

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
            <th />
          </tr>
        </thead>
        <tbody>
          {data.daily.map((d) => {
            const key = `${d.day}-${d.active_song_count}`;
            return (
              <Fragment key={key}>
                <tr>
                  <td>{d.day}</td>
                  <td>{d.active_song_count ?? '—'}</td>
                  <td>{d.points}</td>
                  <td>
                    {d.points}/{d.max_points} ({Math.round((100 * d.points) / d.max_points)}%)
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => toggleDrilldown(d)}>
                      {expandedDay === key ? 'Hide' : 'View details'}
                    </button>
                  </td>
                </tr>
                {expandedDay === key && (
                  <tr>
                    <td colSpan={5}>
                      <div className="attempt-breakdown">
                        {!attemptsByDay[key] ? (
                          <p>Loading...</p>
                        ) : (
                          attemptsByDay[key].map((a, idx) => (
                            <div key={idx} className={`attempt-row ${a.was_correct ? 'is-correct' : 'is-wrong'}`}>
                              <span className="attempt-answer">{a.correct_answer}</span>
                              {a.audio_url && <ClipPlayer src={a.audio_url} />}
                              {a.was_correct ? (
                                <span className="attempt-status">
                                  ✓ {a.mode === 'choice' ? 'guessed from choices, ' : ''}+{a.points} pts
                                </span>
                              ) : (
                                <span className="attempt-status">
                                  ✕ you said "{a.user_answer || '(nothing)'}" — +0 pts
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
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
