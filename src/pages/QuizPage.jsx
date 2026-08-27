import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Autocomplete from '../components/Autocomplete';
import ClipPlayer from '../components/ClipPlayer';
import { answerMatches } from '../lib/normalize';

// bio now goes through the same free-text-first flow as these (autocomplete
// against the full set of bio answers instead of song titles) — see
// bioAnswers prop and isBioAnswer below.
const SONG_ANSWER_TYPES = new Set(['audio', 'lyric', 'theme', 'follow-up']);
// Session length isn't set here — omitting `count` lets the server apply
// its own default (server/index.js's SESSION_LENGTH), which is also the
// single source of truth leaderboard eligibility is checked against. One
// constant to change, not two kept in sync by hand.
// Hardcoded per-type point values. Audio's Expert Mode value (95) is a fixed
// number, not a multiplier on the normal value — a flat 2x let hard-mode
// scores blow past the max_points denominator server-side (see
// server/index.js's MAX_POINTS_SQL), showing >100% accuracy on History.
const DEFAULT_POINTS = 40; // theme/follow-up/album/collaborator/reference
const BIO_POINTS = 60;
function pointsForType(type, expertMode) {
  if (type === 'audio') return expertMode ? 95 : 60;
  if (type === 'bio') return BIO_POINTS;
  return DEFAULT_POINTS;
}
// Lyric points still drop with each "...more" reveal — full credit for
// nailing it cold, less for peeking at more context first.
const LYRIC_REVEAL_POINTS = [100, 70, 50];
const MAX_LYRIC_REVEAL_TIER = LYRIC_REVEAL_POINTS.length - 1;
// A correct pick from the 4-choice fallback (gave up on free-text first)
// earns a flat consolation score reflecting recognition, not recall. It
// still varies by type/difficulty — a bigger "cold" value implies a bigger
// gap to the fallback value too.
const CHOICE_FALLBACK_POINTS = 20; // theme/follow-up/album/collaborator/reference
const LYRIC_CHOICE_FALLBACK_POINTS = 45;
const BIO_CHOICE_FALLBACK_POINTS = 30;
function choiceFallbackPoints(type, expertMode) {
  if (type === 'audio') return expertMode ? 40 : 25;
  if (type === 'lyric') return LYRIC_CHOICE_FALLBACK_POINTS;
  if (type === 'bio') return BIO_CHOICE_FALLBACK_POINTS;
  return CHOICE_FALLBACK_POINTS;
}

async function fetchChoices(q) {
  const res = await fetch('/api/quiz/choices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: q.type, correct_answer: q.correct_answer, question_id: q.id }),
  });
  return res.json();
}

export default function QuizPage({ songTitles, bioAnswers }) {
  const [needsOnboarding, setNeedsOnboarding] = useState(null); // null = still checking
  const [questions, setQuestions] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [activeSongCount, setActiveSongCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [choices, setChoices] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [reveal, setReveal] = useState(null); // { correct, correctAnswer, points }
  const [attempts, setAttempts] = useState([]);
  const [trivia, setTrivia] = useState(null);
  const [lyricTier, setLyricTier] = useState(0);
  const [lyricLines, setLyricLines] = useState(null);
  const [expandedType, setExpandedType] = useState(null);
  const [expertMode, setExpertMode] = useState(false);

  useEffect(() => {
    fetch('/api/user-songs')
      .then((r) => r.json())
      .then(({ song_ids }) => setNeedsOnboarding(song_ids.length === 0));
    fetch('/api/preferences')
      .then((r) => r.json())
      .then((p) => setExpertMode(!!p.expert_mode));
  }, []);

  useEffect(() => {
    if (needsOnboarding !== false) return;
    fetch('/api/quiz/questions')
      .then((r) => r.json())
      .then(({ session_id, active_song_count, questions }) => {
        setSessionId(session_id);
        setActiveSongCount(active_song_count);
        setQuestions(questions);
      });
  }, [needsOnboarding]);

  const q = questions ? questions[index] : null;

  if (needsOnboarding === null) return <p>Loading...</p>;
  if (needsOnboarding) {
    return (
      <p>
        You haven't picked any songs to be quizzed on yet. Head to your <Link to="/profile">Profile</Link> and check
        off the ones you want — you can always add more later.
      </p>
    );
  }
  if (questions === null) return <p>Loading questions...</p>;
  if (questions.length === 0) {
    return (
      <p>
        No questions available yet — the quiz needs audio clips, lyrics, or other song data loaded before it can
        generate questions. See the <code>tools/</code> data pipeline.
      </p>
    );
  }

  // Raw per-type point values (pointsForType etc. above) aren't what shows up
  // on the Leaderboard — that's (songs checked / 2) * points earned (see
  // GET /api/leaderboard). Scaling the live/session-total score the same
  // way means the number you watch climb during a session is the same
  // currency as your Leaderboard entry, not a different, smaller one that
  // jumps at the end.
  const scoreMultiplier = activeSongCount / 2;
  const scaledScore = (rawPoints) => Math.round(rawPoints * scoreMultiplier);

  const isDone = index >= questions.length;

  if (isDone) {
    const total = attempts.reduce((s, a) => s + a.points, 0);
    const byType = {};
    for (const a of attempts) {
      byType[a.question_type] ??= { attempts: 0, correct: 0, points: 0 };
      byType[a.question_type].attempts++;
      byType[a.question_type].correct += a.was_correct ? 1 : 0;
      byType[a.question_type].points += a.points;
    }
    return (
      <div className="results">
        <h2>Session complete — Score: {scaledScore(total)}</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Correct</th>
              <th>Points</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {Object.entries(byType).map(([type, s]) => (
              <Fragment key={type}>
                <tr>
                  <td>{type}</td>
                  <td>
                    {s.correct}/{s.attempts}
                  </td>
                  <td>{s.points}</td>
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => setExpandedType((t) => (t === type ? null : type))}
                    >
                      {expandedType === type ? 'Hide' : 'View details'}
                    </button>
                  </td>
                </tr>
                {expandedType === type && (
                  <tr>
                    <td colSpan={4}>
                      <div className="attempt-breakdown">
                        {attempts
                          .filter((a) => a.question_type === type)
                          .map((a, i) => (
                            <div key={i} className={`attempt-row ${a.was_correct ? 'is-correct' : 'is-wrong'}`}>
                              <span className="attempt-answer">{a.correct_answer}</span>
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
                          ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        <button onClick={() => window.location.reload()}>Play again</button>
      </div>
    );
  }

  async function recordAttempt({ userAnswer, mode, wasCorrect, points }) {
    const attempt = {
      question_type: q.type,
      question_id: q.id,
      song_id: q.song_id,
      session_id: sessionId,
      prompt: q.prompt,
      correct_answer: q.correct_answer,
      user_answer: userAnswer,
      mode,
      was_correct: wasCorrect,
      points,
    };
    fetch('/api/attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attempt),
    });
    setAttempts((prev) => [...prev, attempt]);
    // Fetch trivia BEFORE revealing, not after, so the feedback card (and the
    // Next button below it) renders once at full height instead of popping
    // in and shoving Next down a beat later — that's the "flicker."
    const triviaData = q.song_id ? await fetch(`/api/songs/${q.song_id}/trivia`).then((r) => r.json()) : null;
    setTrivia(triviaData);
    setReveal({ correct: wasCorrect, correctAnswer: q.correct_answer, points });
  }

  function submitFreeAnswer() {
    if (!answer.trim()) return;
    const wasCorrect = answerMatches(answer, q.correct_answer);
    const points = wasCorrect ? (q.type === 'lyric' ? LYRIC_REVEAL_POINTS[lyricTier] : pointsForType(q.type, expertMode)) : 0;
    recordAttempt({ userAnswer: answer, mode: 'free', wasCorrect, points });
  }

  async function revealChoices() {
    setChoices(await fetchChoices(q));
  }

  async function revealMoreLyrics() {
    if (lyricTier >= MAX_LYRIC_REVEAL_TIER) return;
    const tier = lyricTier + 1;
    const count = (q.context_lines || 1) + tier * 2;
    const res = await fetch(`/api/questions/${q.id}/lyric-lines?count=${count}`);
    const data = await res.json();
    setLyricLines(data.lines);
    setLyricTier(tier);
  }

  function pickChoice(choice) {
    setSelectedChoice(choice);
    const wasCorrect = choice === q.correct_answer;
    // Every type now has a free-text step first, so a correct choice pick is
    // always the reduced-credit fallback (gave up on free-text/autocomplete).
    recordAttempt({
      userAnswer: choice,
      mode: 'choice',
      wasCorrect,
      points: wasCorrect ? choiceFallbackPoints(q.type, expertMode) : 0,
    });
  }

  function next() {
    setAnswer('');
    setChoices(null);
    setSelectedChoice(null);
    setReveal(null);
    setTrivia(null);
    setLyricTier(0);
    setLyricLines(null);
    setIndex((i) => i + 1);
  }

  const isSongAnswer = SONG_ANSWER_TYPES.has(q.type);
  const isBioAnswer = q.type === 'bio';
  const displayPrompt =
    q.type === 'lyric' && lyricLines ? `Which song is this lyric from?\n"${lyricLines.join('\n')}"` : q.prompt;

  // Indexed by question position rather than "is reveal truthy yet" —
  // recordAttempt pushes into `attempts` synchronously but only sets
  // `reveal` after an awaited trivia fetch, so gating on `reveal` here left
  // a brief window where attempts.length had already grown but the split
  // hadn't caught up, flashing the wrong number.
  const priorScore = attempts.slice(0, index).reduce((s, a) => s + a.points, 0);
  const currentAttempt = attempts[index] ?? null;
  // Round the two totals independently (prior, and prior+this-question) and
  // take their difference for the displayed "+delta" — rounding the raw
  // delta on its own could show "+X" that doesn't add up to the jump in the
  // total next to it, off by a point from independent rounding.
  const priorScoreScaled = scaledScore(priorScore);
  const newTotalScaled = currentAttempt ? scaledScore(priorScore + currentAttempt.points) : priorScoreScaled;

  function choiceClass(c) {
    if (!reveal) return '';
    if (c === q.correct_answer) return 'correct';
    if (c === selectedChoice) return 'wrong-picked';
    return 'dim';
  }

  return (
    <div className="quiz">
      <p className="progress">
        Question {index + 1} / {questions.length} (Score: {priorScoreScaled}
        {currentAttempt && currentAttempt.points > 0 && (
          <span className="score-delta"> + {newTotalScaled - priorScoreScaled}</span>
        )}
        )
      </p>
      <p className="prompt" style={{ whiteSpace: 'pre-wrap' }}>
        {displayPrompt}
      </p>
      {q.audio_url && <ClipPlayer src={q.audio_url} durationSec={q.clip_duration_sec ?? 5} />}

      {/* One stable card for the whole answering area — its size and position
          never change between "choosing" and "revealed," only its content
          and a border-left accent color do. That's what stops the choice
          buttons from visibly jumping when the answer reveals. */}
      <div className={`answer-surface${reveal ? ` revealed ${reveal.correct ? 'correct' : 'wrong'}` : ''}`}>
        {!reveal ? (
          choices ? (
            <div className="choices">
              {choices === null
                ? 'Loading choices...'
                : choices.map((c) => (
                    <button key={c} onClick={() => pickChoice(c)}>
                      {c}
                    </button>
                  ))}
            </div>
          ) : (
            <>
              {isSongAnswer || isBioAnswer ? (
                <Autocomplete
                  options={isBioAnswer ? bioAnswers : songTitles}
                  placeholder={isBioAnswer ? 'Type an answer...' : 'Type a song title...'}
                  value={answer}
                  onChange={setAnswer}
                  onSubmit={submitFreeAnswer}
                  autoFocus
                />
              ) : (
                <input
                  type="text"
                  value={answer}
                  autoFocus
                  placeholder="Type your answer..."
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitFreeAnswer()}
                />
              )}
              <div className="actions">
                <button className="btn-primary" onClick={submitFreeAnswer}>
                  Submit
                </button>
                <div className="actions-secondary">
                  {lyricTier === 0 && (
                    <button className="btn-secondary" onClick={revealChoices}>
                      I don't know — show 4 choices
                    </button>
                  )}
                  {q.type === 'lyric' && lyricTier < MAX_LYRIC_REVEAL_TIER && (
                    <button className="btn-secondary" onClick={revealMoreLyrics}>
                      Show more lyrics ({LYRIC_REVEAL_POINTS[lyricTier + 1]} pts)
                    </button>
                  )}
                </div>
              </div>
            </>
          )
        ) : (
          <>
            {choices ? (
              <div className="choices">
                {choices.map((c) => (
                  <button key={c} className={choiceClass(c)} disabled>
                    {c}
                  </button>
                ))}
              </div>
            ) : (
              <p className={`feedback-text ${reveal.correct ? 'is-correct' : 'is-wrong'}`}>
                {reveal.correct ? '✓ Correct!' : `✕ Wrong — answer: ${reveal.correctAnswer}`}
              </p>
            )}

            {trivia && (
              <div className="trivia">
                <strong>Did you know{trivia.confidence === 'theory' ? ' (fan theory)' : ''}:</strong>{' '}
                {trivia.term && <em>"{trivia.term}" — </em>}
                {trivia.description}
              </div>
            )}

            <button className="btn-primary next-btn" onClick={next} autoFocus>
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}
