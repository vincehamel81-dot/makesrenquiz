// Question bank: hydrates rows from `questions` into askable {prompt, correct_answer, ...}
// objects, and implements adaptive (recency/frequency-weighted) session selection.
import { db } from './db.js';

export function songRow(id) {
  return db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
}

// Session composition. Defaults match the original fixed split; a user can
// override via user_preferences (see PUT /api/preferences). "trivia" covers
// everything that isn't audio/lyric: theme, follow-up, album, collaborator,
// bio, reference.
const DEFAULT_BUCKET_TARGET = { audio: 0.6, lyric: 0.38, trivia: 0.02 };
function bucketOf(type) {
  return type === 'audio' ? 'audio' : type === 'lyric' ? 'lyric' : 'trivia';
}

function bucketTargetFor(userId) {
  const prefs = db.prepare('SELECT audio_pct, lyric_pct, trivia_pct FROM user_preferences WHERE user_id = ?').get(userId);
  if (!prefs) return DEFAULT_BUCKET_TARGET;
  return { audio: prefs.audio_pct / 100, lyric: prefs.lyric_pct / 100, trivia: prefs.trivia_pct / 100 };
}

function hydrate(row) {
  const song = row.song_id ? songRow(row.song_id) : null;
  switch (row.type) {
    case 'audio':
      return {
        prompt: 'What song is this?',
        audio_url: `/audio/${row.file_path}`,
        clip_duration_sec: row.duration_sec,
        correct_answer: song.title,
      };
    case 'lyric': {
      const lines = db
        .prepare(
          'SELECT text FROM lyrics_lines WHERE song_id = ? AND line_no >= ? AND line_no < ? AND is_header = 0 ORDER BY line_no'
        )
        .all(row.song_id, row.start_line_no, row.start_line_no + row.context_lines);
      return {
        prompt: `Which song is this lyric from?\n"${lines.map((l) => l.text).join('\n')}"`,
        correct_answer: song.title,
        context_lines: row.context_lines,
      };
    }
    case 'theme':
      return { prompt: `Which song talks about: "${row.fact_key}"?`, correct_answer: song.title };
    case 'follow-up': {
      const prev = songRow(song.follow_up_to_id);
      return { prompt: `What song is the follow-up to "${prev.title}"?`, correct_answer: song.title };
    }
    case 'album': {
      const album = db.prepare('SELECT name FROM albums WHERE id = ?').get(song.album_id);
      return { prompt: `What album is "${song.title}" on?`, correct_answer: album.name };
    }
    case 'collaborator':
      return { prompt: `Who collaborated with Ren on "${song.title}"?`, correct_answer: row.fact_key };
    case 'bio': {
      const fact = db.prepare('SELECT question, answer FROM bio_facts WHERE id = ?').get(row.bio_fact_id);
      return { prompt: fact.question, correct_answer: fact.answer };
    }
    case 'reference': {
      const egg = db.prepare('SELECT term FROM easter_eggs WHERE id = ?').get(row.easter_egg_id);
      return { prompt: `Which song mentions/references "${egg.term}"?`, correct_answer: song.title };
    }
    default:
      throw new Error(`unknown question type: ${row.type}`);
  }
}

export function answerDomain(type, userId) {
  switch (type) {
    case 'audio':
    case 'lyric':
    case 'theme':
    case 'follow-up':
    case 'reference':
      // Distractors must come from songs the user actually checked — an
      // unfamiliar title is an instant tell, not a real distractor.
      return db
        .prepare(
          `SELECT s.title FROM songs s JOIN user_songs us ON us.song_id = s.id AND us.user_id = ? ORDER BY s.title`
        )
        .all(userId)
        .map((r) => r.title);
    case 'album':
      return db.prepare('SELECT name FROM albums ORDER BY name').all().map((r) => r.name);
    case 'collaborator':
      return [
        ...new Set(
          db.prepare(`SELECT DISTINCT fact_key FROM questions WHERE type = 'collaborator'`).all().map((r) => r.fact_key)
        ),
      ];
    case 'bio':
      return db.prepare('SELECT answer FROM bio_facts').all().map((r) => r.answer);
    default:
      return [];
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildChoices(type, correctAnswer, questionId, userId) {
  if (type === 'bio' && questionId) {
    const q = db.prepare('SELECT bio_fact_id FROM questions WHERE id = ?').get(questionId);
    const fact = q?.bio_fact_id && db.prepare('SELECT options FROM bio_facts WHERE id = ?').get(q.bio_fact_id);
    if (fact?.options) return shuffle([correctAnswer, ...JSON.parse(fact.options)]);
  }
  const domain = answerDomain(type, userId).filter((a) => a !== correctAnswer);
  const distractors = shuffle(domain).slice(0, 3);
  return shuffle([correctAnswer, ...distractors]);
}

// Adaptive selection: eligible rows (pending or active, and structurally complete)
// weighted by type priority * per-row weight, damped by how often/recently asked
// so the same clip/line doesn't come up again and again. Scoped to a user's
// checked songs: audio/lyric rows require the song to be checked; trivia-bucket
// rows are eligible if they're song-agnostic (song_id NULL, e.g. general Ren
// bio facts) or their song is checked.
function eligibleRows(userId) {
  const checkedIds = new Set(
    db.prepare('SELECT song_id FROM user_songs WHERE user_id = ?').all(userId).map((r) => r.song_id)
  );
  const rows = db
    .prepare(
      `SELECT * FROM questions
       WHERE status IN ('pending','active')
         AND (type != 'audio' OR file_path IS NOT NULL)
         AND (type != 'lyric' OR start_line_no IS NOT NULL)`
    )
    .all();
  return rows.filter((row) => {
    if (row.type === 'audio' || row.type === 'lyric') return checkedIds.has(row.song_id);
    return row.song_id === null || checkedIds.has(row.song_id);
  });
}

function recencyFactor(row) {
  let factor = 1 / (1 + row.times_asked);
  if (row.last_asked_at) {
    const hoursSince = (Date.now() - new Date(row.last_asked_at + 'Z').getTime()) / 3.6e6;
    if (hoursSince < 72) factor *= 0.15;
  }
  return factor;
}

// Weighted-random pick of up to `n` rows from `rows`, without replacement,
// skipping anything already in `usedIds`.
function pickWeighted(rows, n, usedIds) {
  const pool = rows.map((row) => ({ row, weight: row.weight * recencyFactor(row) }));
  const picked = [];
  for (let i = 0; i < n; i++) {
    const candidates = pool.filter((p) => !usedIds.has(p.row.id));
    if (candidates.length === 0) break;
    const total = candidates.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    let sel = candidates[candidates.length - 1];
    for (const p of candidates) {
      r -= p.weight;
      if (r <= 0) {
        sel = p;
        break;
      }
    }
    usedIds.add(sel.row.id);
    picked.push(sel.row);
  }
  return picked;
}

// Largest-remainder rounding so bucket targets always sum to exactly `count`.
function bucketTargets(count, bucketTarget) {
  const raw = Object.entries(bucketTarget).map(([bucket, pct]) => [bucket, pct * count]);
  const targets = {};
  let allocated = 0;
  for (const [bucket, r] of raw) {
    targets[bucket] = Math.floor(r);
    allocated += targets[bucket];
  }
  const remainders = raw.map(([bucket, r]) => [bucket, r - Math.floor(r)]).sort((a, b) => b[1] - a[1]);
  let leftover = count - allocated;
  for (const [bucket] of remainders) {
    if (leftover <= 0) break;
    targets[bucket]++;
    leftover--;
  }
  return targets;
}

export function generateSession(count = 30, userId) {
  const rows = eligibleRows(userId);
  if (rows.length === 0) return [];

  const byBucket = { audio: [], lyric: [], trivia: [] };
  for (const row of rows) byBucket[bucketOf(row.type)].push(row);

  const bucketTarget = bucketTargetFor(userId);
  const targets = bucketTargets(count, bucketTarget);
  const usedIds = new Set();
  let selected = [];
  for (const bucket of Object.keys(bucketTarget)) {
    selected.push(...pickWeighted(byBucket[bucket], targets[bucket], usedIds));
  }

  // A thin bucket (e.g. "other" with sparse metadata) can come up short —
  // backfill from whatever's left so the session still hits `count`.
  const shortfall = count - selected.length;
  if (shortfall > 0) {
    selected.push(...pickWeighted(rows, shortfall, usedIds));
  }

  const questions = [];
  for (const row of shuffle(selected)) {
    try {
      questions.push({ id: row.id, type: row.type, song_id: row.song_id, ...hydrate(row) });
    } catch {
      // song/album/bio fact referenced no longer resolves cleanly; skip it
    }
  }
  return questions;
}

// A random easter egg for a song, shown as a "did you know" note after a
// question about that song is answered — the point is to learn, not just score.
export function randomTriviaForSong(songId) {
  const eggs = db
    .prepare('SELECT term, description, confidence FROM easter_eggs WHERE song_id = ? AND deleted = 0')
    .all(songId);
  if (eggs.length === 0) return null;
  return eggs[Math.floor(Math.random() * eggs.length)];
}

export function markAsked(questionId, wasCorrect) {
  db.prepare(
    `UPDATE questions SET times_asked = times_asked + 1, times_correct = times_correct + ?, last_asked_at = datetime('now') WHERE id = ?`
  ).run(wasCorrect ? 1 : 0, questionId);
}
