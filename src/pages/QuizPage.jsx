import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SongAutocomplete from '../components/SongAutocomplete';
import ClipPlayer from '../components/ClipPlayer';
import { answerMatches } from '../lib/normalize';

const SONG_ANSWER_TYPES = new Set(['audio', 'lyric', 'theme', 'follow-up']);
// Types whose correct_answer is a full sentence/prose fact — typing it
// exactly was never a fair bar, so these skip straight to 4 choices and
// award full credit (there's no "lesser" free-text path being avoided).
const FORCE_CHOICE_TYPES = new Set(['bio']);
// Session length isn't set here — omitting `count` lets the server apply
// its own default (server/index.js's SESSION_LENGTH), which is also the
// single source of truth leaderboard eligibility is checked against. One
// constant to change, not two kept in sync by hand.
// Hardcoded per-type point values (lyrics score highest since they're the
// hardest to pin down cold, then clips, then everything else).
const TYPE_POINTS = { audio: 45, lyric: 50 };
const DEFAULT_POINTS = 40; // theme/follow-up/album/collaborator/bio/reference
function pointsForType(type) {
  return TYPE_POINTS[type] ?? DEFAULT_POINTS;
}
// Lyric points still drop with each "...more" reveal — full credit for
// nailing it cold, less for peeking at more context first.
const LYRIC_REVEAL_POINTS = [50, 30, 15];
const MAX_LYRIC_REVEAL_TIER = LYRIC_REVEAL_POINTS.length - 1;
// A correct pick from the 4-choice fallback (gave up on free-text first)
// earns a flat consolation score, the same across every type — it reflects
// recognition, not recall, so it doesn't scale with how hard the type is.
const CHOICE_FALLBACK_POINTS = 20;

async function fetchChoices(q) {
  const res = await fetch('/api/quiz/choices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: q.type, correct_answer: q.correct_answer, question_id: q.id }),
  });
  return res.json();
}

export default function QuizPage({ songTitles }) {
  const [needsOnboarding, setNeedsOnboarding] = useState(null); // null = still checking
  const [questions, setQuestions] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [choices, setChoices] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [reveal, setReveal] = useState(null); // { correct, correctAnswer, points }
  const [attempts, setAttempts] = useState([]);
  const [trivia, setTrivia] = useState(null);
  const [lyricTier, setLyricTier] = useState(0);
  const [lyricLines, setLyricLines] = useState(null);

  useEffect(() => {
    fetch('/api/user-songs')
      .then((r) => r.json())
      .then(({ song_ids }) => setNeedsOnboarding(song_ids.length === 0));
  }, []);

  useEffect(() => {
    if (needsOnboarding !== false) return;
    fetch('/api/quiz/questions')
      .then((r) => r.json())
      .then(({ session_id, questions }) => {
        setSessionId(session_id);
        setQuestions(questions);
      });
  }, [needsOnboarding]);

  const q = questions ? questions[index] : null;
  const isForceChoice = q && FORCE_CHOICE_TYPES.has(q.type);

  // Force-choice types (bio) preload their options as soon as the question
  // appears, since there's no free-text step to opt out of first.
  useEffect(() => {
    if (q && FORCE_CHOICE_TYPES.has(q.type)) {
      fetchChoices(q).then(setChoices);
    }
  }, [q?.id]);

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
        <h2>Session complete — {total} points</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Correct</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byType).map(([type, s]) => (
              <tr key={type}>
                <td>{type}</td>
                <td>
                  {s.correct}/{s.attempts}
                </td>
                <td>{s.points}</td>
              </tr>
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
    const points = wasCorrect ? (q.type === 'lyric' ? LYRIC_REVEAL_POINTS[lyricTier] : pointsForType(q.type)) : 0;
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
    // Force-choice types have no free-text path to fall back from, so a
    // correct pick here is the primary signal of knowing it, not a guess —
    // full credit. A regular choice-fallback (gave up on free-text first)
    // earns the flat consolation score instead.
    recordAttempt({
      userAnswer: choice,
      mode: isForceChoice ? 'free' : 'choice',
      wasCorrect,
      points: wasCorrect ? (isForceChoice ? pointsForType(q.type) : CHOICE_FALLBACK_POINTS) : 0,
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
  const displayPrompt =
    q.type === 'lyric' && lyricLines ? `Which song is this lyric from?\n"${lyricLines.join('\n')}"` : q.prompt;

  function choiceClass(c) {
    if (!reveal) return '';
    if (c === q.correct_answer) return 'correct';
    if (c === selectedChoice) return 'wrong-picked';
    return 'dim';
  }

  return (
    <div className="quiz">
      <p className="progress">
        Question {index + 1} / {questions.length}
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
          isForceChoice || choices ? (
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
              {isSongAnswer ? (
                <SongAutocomplete
                  songTitles={songTitles}
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
                {reveal.correct ? 'Correct!' : `Wrong — answer: ${reveal.correctAnswer}`}
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
