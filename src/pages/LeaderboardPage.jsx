import { Fragment, useEffect, useState } from 'react';
import ClipPlayer from '../components/ClipPlayer';
import { SCORING_TABLE } from '../lib/scoring';

// v1 formula (placeholder, will be retuned): active_song_count * points,
// from each user's best fully-completed session. Shorter sessions still
// show up in that user's own History, just not here — see GET /api/leaderboard,
// which is also where session_length actually comes from (not hardcoded here).
export default function LeaderboardPage() {
  const [data, setData] = useState(null);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [attemptsBySession, setAttemptsBySession] = useState({});
  const [showScoringKey, setShowScoringKey] = useState(false);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then(setData);
  }, []);

  async function toggleDrilldown(entry) {
    if (expandedUserId === entry.user_id) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(entry.user_id);
    if (!attemptsBySession[entry.session_id]) {
      const attempts = await fetch(`/api/leaderboard/${entry.session_id}/attempts`).then((r) => r.json());
      setAttemptsBySession((prev) => ({ ...prev, [entry.session_id]: attempts }));
    }
  }

  if (!data) return <p>Loading...</p>;
  const { session_length, limit, entries } = data;

  return (
    <div className="leaderboard">
      <h2>
        Leaderboard{' '}
        <span className="info-popover-anchor">
          <button
            className="info-icon"
            onClick={() => setShowScoringKey((v) => !v)}
            aria-label="Scoring key"
            title="Scoring key"
          >
            ?
          </button>
          {showScoringKey && (
            <div className="info-popover">
              <table>
                <tbody>
                  {SCORING_TABLE.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </span>
      </h2>
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
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((r, i) => (
              <Fragment key={r.user_id}>
                <tr>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td>{r.active_song_count}</td>
                  <td>{r.score}</td>
                  <td>
                    <button className="btn-secondary" onClick={() => toggleDrilldown(r)}>
                      {expandedUserId === r.user_id ? 'Hide' : 'View details'}
                    </button>
                  </td>
                </tr>
                {expandedUserId === r.user_id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="attempt-breakdown">
                        {!attemptsBySession[r.session_id] ? (
                          <p>Loading...</p>
                        ) : (
                          attemptsBySession[r.session_id].map((a, idx) => (
                            <div key={idx} className={`attempt-row ${a.was_correct ? 'is-correct' : 'is-wrong'}`}>
                              <span className="attempt-answer">{a.correct_answer}</span>
                              {a.audio_url && <ClipPlayer src={a.audio_url} />}
                              {a.was_correct ? (
                                <span className="attempt-status">
                                  ✓ {a.mode === 'choice' ? 'guessed from choices, ' : ''}+{a.points} pts
                                </span>
                              ) : (
                                <span className="attempt-status">
                                  ✕ they said "{a.user_answer || '(nothing)'}" — +0 pts
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
