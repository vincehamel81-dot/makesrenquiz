import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { generateSession, buildChoices, markAsked, randomTriviaForSong } from './questionTypes.js';
import { applyFeedback } from './feedback.js';
import { rebuildLyricQuestions } from './lyricQuestions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use('/audio', express.static(path.join(__dirname, '..', 'public', 'audio')));

// Song titles for autocomplete, or (with ?stats=1) the enriched list for the
// browsable Songs page: lyric/clip/easter-egg counts so you can see at a
// glance what's still missing.
app.get('/api/songs', (req, res) => {
  if (!req.query.stats) {
    return res.json(db.prepare('SELECT id, title, slug FROM songs ORDER BY title').all());
  }
  const songs = db
    .prepare(
      `SELECT s.id, s.title, s.slug, s.personal_rating, s.youtube_url, a.name as album_name,
              (SELECT COUNT(*) FROM lyrics_lines ll WHERE ll.song_id = s.id AND ll.is_header = 0) as lyricLineCount,
              (SELECT COUNT(*) FROM questions q WHERE q.song_id = s.id AND q.type = 'audio' AND q.status != 'retired') as clipCount,
              (SELECT COUNT(*) FROM easter_eggs e WHERE e.song_id = s.id AND e.deleted = 0) as easterEggCount
       FROM songs s LEFT JOIN albums a ON a.id = s.album_id ORDER BY s.title`
    )
    .all();
  res.json(songs);
});

// A fresh batch of quiz questions, adaptively sampled from the question bank
app.get('/api/quiz/questions', (req, res) => {
  const count = Math.min(Number(req.query.count) || 30, 100);
  res.json(generateSession(count));
});

// Multiple-choice reveal for a given question
app.post('/api/quiz/choices', (req, res) => {
  const { type, correct_answer, question_id } = req.body;
  if (!type || !correct_answer) return res.status(400).json({ error: 'type and correct_answer required' });
  try {
    res.json(buildChoices(type, correct_answer, question_id));
  } catch {
    res.status(400).json({ error: 'unknown question type' });
  }
});

// Record an attempt
app.post('/api/attempts', (req, res) => {
  const { question_type, question_id, song_id, prompt, correct_answer, user_answer, mode, was_correct, points } =
    req.body;
  db.prepare(
    `INSERT INTO quiz_attempts (question_type, question_id, song_id, prompt, correct_answer, user_answer, mode, was_correct, points)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    question_type,
    question_id ?? null,
    song_id ?? null,
    prompt,
    correct_answer,
    user_answer ?? null,
    mode,
    was_correct ? 1 : 0,
    points
  );
  if (question_id) markAsked(question_id, was_correct);
  res.status(201).json({ ok: true });
});

// Calibration feedback on a bank question: perfect | too_hard | too_easy | not_relevant
app.post('/api/questions/:id/feedback', (req, res) => {
  const { action } = req.body;
  try {
    res.json(applyFeedback(Number(req.params.id), action));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Progressive lyric reveal — "...more" trades points for extra context.
// `count` is the total number of lines wanted from the start of the
// question's bundle, not an increment, so the client can just re-request a
// bigger number each time rather than tracking an offset.
app.get('/api/questions/:id/lyric-lines', (req, res) => {
  const q = db.prepare(`SELECT song_id, start_line_no FROM questions WHERE id = ? AND type = 'lyric'`).get(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  const count = Math.min(Math.max(Number(req.query.count) || 2, 1), 12);
  const lines = db
    .prepare(
      `SELECT text FROM lyrics_lines WHERE song_id = ? AND line_no >= ? AND is_header = 0 ORDER BY line_no LIMIT ?`
    )
    .all(q.song_id, q.start_line_no, count);
  res.json({ lines: lines.map((l) => l.text) });
});

// History: daily totals + accuracy by question type. Same half-credit rule
// as Song Knowledge — a correct 4-choice guess counts as 0.5 here too, so
// the accuracy trend reflects actually knowing things, not luck.
const CORRECT_WEIGHTED = `SUM(CASE WHEN was_correct = 1 THEN (CASE WHEN mode = 'choice' THEN 0.5 ELSE 1.0 END) ELSE 0 END)`;
app.get('/api/history', (_req, res) => {
  const daily = db
    .prepare(
      `SELECT date(played_at) as day, SUM(points) as points, COUNT(*) as attempts,
              ${CORRECT_WEIGHTED} as correct
       FROM quiz_attempts GROUP BY day ORDER BY day`
    )
    .all();
  const byType = db
    .prepare(
      `SELECT question_type, COUNT(*) as attempts, ${CORRECT_WEIGHTED} as correct, SUM(points) as points
       FROM quiz_attempts GROUP BY question_type`
    )
    .all();
  res.json({ daily, byType });
});

// A "did you know" trivia snippet for a song, shown after answering
app.get('/api/songs/:id/trivia', (req, res) => {
  res.json(randomTriviaForSong(Number(req.params.id)));
});

// Full song detail: lyrics + easter eggs, for the browsable song list
app.get('/api/songs/:slug/detail', (req, res) => {
  const song = db
    .prepare(
      `SELECT s.*, a.name as album_name FROM songs s LEFT JOIN albums a ON a.id = s.album_id WHERE s.slug = ?`
    )
    .get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const lyrics = db.prepare('SELECT line_no, text, is_header FROM lyrics_lines WHERE song_id = ? ORDER BY line_no').all(song.id);
  const easterEggs = db
    .prepare('SELECT id, term, description, confidence, source_url FROM easter_eggs WHERE song_id = ? AND deleted = 0 ORDER BY id')
    .all(song.id);
  const clips = db
    .prepare(
      `SELECT id, start_sec, duration_sec, file_path FROM questions
       WHERE song_id = ? AND type = 'audio' AND status != 'retired' ORDER BY start_sec`
    )
    .all(song.id);
  res.json({
    ...song,
    collaborators: JSON.parse(song.collaborators || '[]'),
    themes: JSON.parse(song.themes || '[]'),
    lyrics,
    easterEggs,
    clips,
  });
});

// Manual lyrics editor — for spoken-word/non-song entries or filling gaps
// the scraper couldn't find. Replaces the song's lines and rebuilds its
// slice of the lyric question pool.
app.put('/api/songs/:slug/lyrics', (req, res) => {
  const song = db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const { text } = req.body;
  if (typeof text !== 'string') return res.status(400).json({ error: 'text (string) required' });

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  db.prepare('DELETE FROM lyrics_lines WHERE song_id = ?').run(song.id);
  const insertLine = db.prepare('INSERT INTO lyrics_lines (song_id, line_no, text, is_header) VALUES (?, ?, ?, ?)');
  let lineNo = 0;
  for (const line of lines) {
    lineNo++;
    const isHeader =
      /^\[.*\]$/.test(line) ||
      /^(intro|outro|verse\s*\d*|chorus|pre-chorus|bridge|hook|refrain|interlude|breakdown|drop)s?:?\s*$/i.test(line);
    insertLine.run(song.id, lineNo, line, isHeader ? 1 : 0);
  }

  const summary = rebuildLyricQuestions();
  res.json({ lineCount: lines.length, ...summary });
});

// Soft-delete an easter egg you don't find useful. Any quiz question built
// from it is retired (not deleted, in case it has attempt history).
app.delete('/api/easter-eggs/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE easter_eggs SET deleted = 1 WHERE id = ?').run(id);
  db.prepare(`UPDATE questions SET status = 'retired' WHERE type = 'reference' AND easter_egg_id = ?`).run(id);
  res.json({ ok: true });
});

// Manually add an easter egg from the song page.
app.post('/api/songs/:slug/easter-eggs', (req, res) => {
  const song = db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const { term, description, confidence, quizzable, source_url } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });
  const info = db
    .prepare(
      `INSERT INTO easter_eggs (song_id, term, description, confidence, quizzable, source_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(song.id, term || null, description, confidence === 'confirmed' ? 'confirmed' : 'theory', quizzable ? 1 : 0, source_url || null);
  if (quizzable && term) {
    db.prepare(`INSERT INTO questions (type, song_id, easter_egg_id) VALUES ('reference', ?, ?)`).run(song.id, info.lastInsertRowid);
  }
  res.status(201).json({ id: info.lastInsertRowid });
});

// Retire a single quiz question (e.g. one bad audio clip) without touching
// the rest of the song's data. Soft-delete, consistent with the calibration
// feedback's "not relevant" action.
app.delete('/api/questions/:id', (req, res) => {
  db.prepare(`UPDATE questions SET status = 'retired' WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

// Permanently remove a song (e.g. a duplicate) and everything tied to it —
// lyrics, questions, easter eggs. Any past quiz_attempts referencing it are
// preserved but detached (song_id set null) rather than deleted, so your
// score history stays intact. Other songs' follow_up_to pointing at this one
// are cleared too.
app.delete('/api/songs/:slug', (req, res) => {
  const song = db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const id = song.id;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE quiz_attempts SET song_id = NULL WHERE song_id = ?').run(id);
    db.prepare(
      `UPDATE quiz_attempts SET question_id = NULL WHERE question_id IN (SELECT id FROM questions WHERE song_id = ?)`
    ).run(id);
    db.prepare('UPDATE songs SET follow_up_to_id = NULL WHERE follow_up_to_id = ?').run(id);
    db.prepare(
      `DELETE FROM questions WHERE easter_egg_id IN (SELECT id FROM easter_eggs WHERE song_id = ?)`
    ).run(id);
    db.prepare('DELETE FROM easter_eggs WHERE song_id = ?').run(id);
    db.prepare('DELETE FROM questions WHERE song_id = ?').run(id);
    db.prepare('DELETE FROM lyrics_lines WHERE song_id = ?').run(id);
    db.prepare('DELETE FROM songs WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true });
});

// Set your own personal preference rating (0-1000) for a song.
app.put('/api/songs/:slug/rating', (req, res) => {
  const song = db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const rating = Number(req.body.rating);
  if (!Number.isFinite(rating)) return res.status(400).json({ error: 'rating (number) required' });
  db.prepare('UPDATE songs SET personal_rating = ? WHERE id = ?').run(rating, song.id);
  res.json({ ok: true, rating });
});

app.put('/api/songs/:slug/title', (req, res) => {
  const song = db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    db.prepare('UPDATE songs SET title = ? WHERE id = ?').run(title, song.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true, title });
});

app.put('/api/songs/:slug/youtube-url', (req, res) => {
  const song = db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const url = (req.body.youtube_url || '').trim() || null;
  db.prepare('UPDATE songs SET youtube_url = ? WHERE id = ?').run(url, song.id);
  res.json({ ok: true, youtube_url: url });
});

// Word/name lookup across lyrics — whole-word match (so "rain" doesn't hit
// "trainer"). SQLite LIKE has no word-boundary concept, so we pre-filter
// broadly with LIKE (cheap, uses the text index) then apply a real regex
// boundary check in JS.
app.get('/api/lookup', (req, res) => {
  const word = (req.query.word || '').trim();
  if (!word) return res.json([]);
  const candidates = db
    .prepare(
      `SELECT s.title, s.slug, ll.line_no, ll.text FROM lyrics_lines ll
       JOIN songs s ON s.id = ll.song_id
       WHERE ll.text LIKE ? COLLATE NOCASE AND ll.is_header = 0
       ORDER BY s.title, ll.line_no`
    )
    .all(`%${word}%`);
  const boundary = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  res.json(candidates.filter((r) => boundary.test(r.text)));
});

// Per-song accuracy broken down into lyrics / audio-clip / other-fact
// questions, for the "Song Knowledge" practice view. A correct answer picked
// from the 4-choice fallback counts as half credit here — it reflects
// recognition/hesitation, not the same confident recall as a free-typed
// answer, even though the fraction itself isn't a literal accuracy %.
app.get('/api/stats/songs', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT song_id, question_type, COUNT(*) as attempts,
              SUM(CASE WHEN was_correct = 1 THEN (CASE WHEN mode = 'choice' THEN 0.5 ELSE 1.0 END) ELSE 0 END) as correct
       FROM quiz_attempts WHERE song_id IS NOT NULL GROUP BY song_id, question_type`
    )
    .all();
  const bucketOf = (type) => (type === 'lyric' ? 'lyrics' : type === 'audio' ? 'video' : 'other');

  const bySong = new Map();
  for (const r of rows) {
    if (!bySong.has(r.song_id)) {
      bySong.set(r.song_id, {
        lyrics: { correct: 0, total: 0 },
        video: { correct: 0, total: 0 },
        other: { correct: 0, total: 0 },
      });
    }
    const bucket = bySong.get(r.song_id)[bucketOf(r.question_type)];
    bucket.correct += r.correct;
    bucket.total += r.attempts;
  }

  const songs = db.prepare('SELECT id, title, slug, personal_rating FROM songs ORDER BY title').all();
  res.json(
    songs.map((s) => ({
      title: s.title,
      slug: s.slug,
      rating: s.personal_rating,
      ...(bySong.get(s.id) ?? {
        lyrics: { correct: 0, total: 0 },
        video: { correct: 0, total: 0 },
        other: { correct: 0, total: 0 },
      }),
    }))
  );
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`renquiz API listening on http://localhost:${PORT}`));
