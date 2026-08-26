import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, withTransaction, batchWrite } from './db.js';
import { generateSession, buildChoices, markAsked, randomTriviaForSong, audioClipUrl } from './questionTypes.js';
import { applyFeedback } from './feedback.js';
import { rebuildLyricQuestions } from './lyricQuestions.js';
import { currentUserId, requireAuth, requireAdmin } from './auth.js';
import {
  verifyGoogleToken,
  findOrCreateUser,
  signSession,
  verifySession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_MS,
} from './googleAuth.js';
import { DISPLAY_NAME_PATTERN } from './lib/randomDisplayName.js';

// Standard quiz session length — also what a session needs to hit to be
// leaderboard-eligible (see GET /api/leaderboard). Mirrored on the client
// (QuizPage.jsx's SESSION_LENGTH) for the initial fetch.
const SESSION_LENGTH = 25;

// How many ranked entries the Leaderboard shows — matches SESSION_LENGTH
// (top 25 for a 25-question session) purely as a memorable default, not a
// derived value; change independently if that stops making sense.
const LEADERBOARD_LIMIT = 25;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use('/audio', express.static(path.join(__dirname, '..', 'public', 'audio')));

// Decodes the session cookie if present and sets req.userId/req.userRole —
// never rejects by itself. requireAuth/requireAdmin (server/auth.js) are
// what actually gate a route; routes that stay public (Songs, Lyric
// lookup) just read currentUserId(req), which is null when signed out.
app.use((req, _res, next) => {
  const token = req.cookies[SESSION_COOKIE_NAME];
  const session = token && verifySession(token);
  if (session) {
    req.userId = session.userId;
    req.userRole = session.role;
  }
  next();
});

app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  let payload;
  try {
    payload = await verifyGoogleToken(token);
  } catch {
    return res.status(401).json({ error: 'invalid Google token' });
  }
  const user = await findOrCreateUser(payload);
  const session = signSession(user);
  res.cookie(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: !!process.env.VERCEL,
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, picture_url: user.picture_url });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  if (!req.userId) return res.json(null);
  const user = await db
    .prepare('SELECT id, name, display_name, email, role, picture_url FROM users WHERE id = ?')
    .get(req.userId);
  res.json(user ?? null);
});

// The public-facing username (topbar, Leaderboard) — kept separate from the
// real Google `name` so nobody's real name is shown by default.
app.put('/api/profile', requireAuth, async (req, res) => {
  const displayName = String(req.body.display_name ?? '').trim();
  if (!DISPLAY_NAME_PATTERN.test(displayName)) {
    return res.status(400).json({ error: 'display_name must be 3-15 letters/numbers only' });
  }
  const taken = await db
    .prepare('SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE AND id != ?')
    .get(displayName, currentUserId(req));
  if (taken) return res.status(409).json({ error: 'that name is already taken' });

  await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, currentUserId(req));
  res.json({ ok: true });
});

// Song titles for autocomplete, or (with ?stats=1) the enriched list for the
// browsable Songs page: lyric/clip/easter-egg counts so you can see at a
// glance what's still missing.
app.get('/api/songs', async (req, res) => {
  if (!req.query.stats) {
    return res.json(await db.prepare('SELECT id, title, slug FROM songs ORDER BY title').all());
  }
  const userId = currentUserId(req);
  const songs = await db
    .prepare(
      `SELECT s.id, s.title, s.slug, s.youtube_url, a.name as album_name, a.release_date as album_release_date,
              COALESCE((SELECT rating FROM user_song_ratings r WHERE r.song_id = s.id AND r.user_id = ?), 0) as rating,
              EXISTS(SELECT 1 FROM user_songs us WHERE us.song_id = s.id AND us.user_id = ?) as known,
              (SELECT COUNT(*) FROM lyrics_lines ll WHERE ll.song_id = s.id AND ll.is_header = 0) as lyricLineCount,
              (SELECT COUNT(*) FROM questions q WHERE q.song_id = s.id AND q.type = 'audio' AND q.status != 'retired') as clipCount,
              (SELECT COUNT(*) FROM easter_eggs e WHERE e.song_id = s.id AND e.deleted = 0) as easterEggCount,
              (SELECT file_path FROM questions q WHERE q.song_id = s.id AND q.type = 'audio' AND q.status != 'retired'
               ORDER BY q.start_sec LIMIT 1) as sample_clip_path
       FROM songs s LEFT JOIN albums a ON a.id = s.album_id ORDER BY s.title`
    )
    .all(userId, userId);
  res.json(
    songs.map((s) => ({
      ...s,
      known: !!s.known,
      sample_clip_url: s.sample_clip_path ? audioClipUrl(s.sample_clip_path) : null,
      sample_clip_path: undefined,
    }))
  );
});

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Add a new song. Auto-checked for the creator, since adding it here means
// you want to be quizzed on it — though it won't produce any audio/lyric
// questions until the data pipeline (tools/) processes it.
app.post('/api/songs', requireAdmin, async (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  const slug = slugify(title);
  if (!slug) return res.status(400).json({ error: 'could not derive a slug from title' });
  if (await db.prepare('SELECT 1 FROM songs WHERE slug = ?').get(slug)) {
    return res.status(409).json({ error: 'a song with this title (or a very similar one) already exists' });
  }

  let album_id = null;
  const albumName = (req.body.album || '').trim();
  if (albumName) {
    await db.prepare('INSERT INTO albums (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(albumName);
    album_id = (await db.prepare('SELECT id FROM albums WHERE name = ?').get(albumName)).id;
  }
  const collaborators = Array.isArray(req.body.collaborators)
    ? req.body.collaborators.map((c) => c.trim()).filter(Boolean)
    : [];
  const youtube_url = (req.body.youtube_url || '').trim() || null;

  try {
    const info = await db
      .prepare(
        `INSERT INTO songs (title, slug, album_id, collaborators, themes, youtube_url) VALUES (?, ?, ?, ?, '[]', ?)`
      )
      .run(title, slug, album_id, JSON.stringify(collaborators), youtube_url);
    await db.prepare('INSERT OR IGNORE INTO user_songs (user_id, song_id) VALUES (?, ?)').run(
      currentUserId(req),
      info.lastInsertRowid
    );
    res.status(201).json({ id: info.lastInsertRowid, slug });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Which songs the current user has checked off as "known" / wants quizzed on.
// An empty list is the signal the Quiz page uses to show the onboarding gate.
app.get('/api/user-songs', requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT song_id FROM user_songs WHERE user_id = ?').all(currentUserId(req));
  res.json({ song_ids: rows.map((r) => r.song_id) });
});

app.put('/api/user-songs/:songId', requireAuth, async (req, res) => {
  await db.prepare('INSERT OR IGNORE INTO user_songs (user_id, song_id) VALUES (?, ?)').run(
    currentUserId(req),
    Number(req.params.songId)
  );
  res.json({ ok: true });
});

app.delete('/api/user-songs/:songId', requireAuth, async (req, res) => {
  await db.prepare('DELETE FROM user_songs WHERE user_id = ? AND song_id = ?').run(
    currentUserId(req),
    Number(req.params.songId)
  );
  res.json({ ok: true });
});

const DEFAULT_PREFERENCES = { audio_pct: 60, lyric_pct: 38, trivia_pct: 2 };

// Your audio/lyric/trivia quiz mix. No saved row yet just means "use the
// defaults" — same pattern as ratings, nothing is written until you save.
app.get('/api/preferences', requireAuth, async (req, res) => {
  const prefs = await db
    .prepare('SELECT audio_pct, lyric_pct, trivia_pct FROM user_preferences WHERE user_id = ?')
    .get(currentUserId(req));
  res.json(prefs ?? DEFAULT_PREFERENCES);
});

app.put('/api/preferences', requireAuth, async (req, res) => {
  const audio_pct = Number(req.body.audio_pct);
  const lyric_pct = Number(req.body.lyric_pct);
  const trivia_pct = Number(req.body.trivia_pct);
  if (![audio_pct, lyric_pct, trivia_pct].every(Number.isFinite)) {
    return res.status(400).json({ error: 'audio_pct, lyric_pct, trivia_pct (numbers) required' });
  }
  if (audio_pct + lyric_pct + trivia_pct !== 100) {
    return res.status(400).json({ error: 'audio_pct + lyric_pct + trivia_pct must sum to 100' });
  }
  await db.prepare(
    `INSERT INTO user_preferences (user_id, audio_pct, lyric_pct, trivia_pct) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET audio_pct = excluded.audio_pct, lyric_pct = excluded.lyric_pct, trivia_pct = excluded.trivia_pct`
  ).run(currentUserId(req), audio_pct, lyric_pct, trivia_pct);
  res.json({ ok: true, audio_pct, lyric_pct, trivia_pct });
});

// A fresh batch of quiz questions, adaptively sampled from the question bank,
// scoped to the user's checked songs and their audio/lyric/trivia ratio.
// Also opens a quiz_sessions row, snapshotting how many songs were checked
// at the time — History groups by this, and the Leaderboard uses it to
// weight completed sessions.
app.get('/api/quiz/questions', requireAuth, async (req, res) => {
  const count = Math.min(Number(req.query.count) || SESSION_LENGTH, 100);
  const userId = currentUserId(req);
  const activeSongCount = (await db.prepare('SELECT COUNT(*) as n FROM user_songs WHERE user_id = ?').get(userId)).n;
  const { lastInsertRowid: sessionId } = await db
    .prepare('INSERT INTO quiz_sessions (user_id, requested_count, active_song_count) VALUES (?, ?, ?)')
    .run(userId, count, activeSongCount);
  res.json({ session_id: sessionId, active_song_count: activeSongCount, questions: await generateSession(count, userId) });
});

// Multiple-choice reveal for a given question
app.post('/api/quiz/choices', requireAuth, async (req, res) => {
  const { type, correct_answer, question_id } = req.body;
  if (!type || !correct_answer) return res.status(400).json({ error: 'type and correct_answer required' });
  try {
    res.json(await buildChoices(type, correct_answer, question_id, currentUserId(req)));
  } catch {
    res.status(400).json({ error: 'unknown question type' });
  }
});

// Record an attempt
app.post('/api/attempts', requireAuth, async (req, res) => {
  const { question_type, question_id, song_id, session_id, prompt, correct_answer, user_answer, mode, was_correct, points } =
    req.body;
  await db.prepare(
    `INSERT INTO quiz_attempts (user_id, session_id, question_type, question_id, song_id, prompt, correct_answer, user_answer, mode, was_correct, points)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    currentUserId(req),
    session_id ?? null,
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
  if (question_id) await markAsked(question_id, was_correct);
  res.status(201).json({ ok: true });
});

// Calibration feedback on a bank question: perfect | too_hard | too_easy | not_relevant
app.post('/api/questions/:id/feedback', requireAdmin, async (req, res) => {
  const { action } = req.body;
  try {
    res.json(await applyFeedback(Number(req.params.id), action));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Progressive lyric reveal — "...more" trades points for extra context.
// `count` is the total number of lines wanted from the start of the
// question's bundle, not an increment, so the client can just re-request a
// bigger number each time rather than tracking an offset.
app.get('/api/questions/:id/lyric-lines', requireAuth, async (req, res) => {
  const q = await db.prepare(`SELECT song_id, start_line_no FROM questions WHERE id = ? AND type = 'lyric'`).get(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  const count = Math.min(Math.max(Number(req.query.count) || 2, 1), 12);
  const lines = await db
    .prepare(
      `SELECT text FROM lyrics_lines WHERE song_id = ? AND line_no >= ? AND is_header = 0 ORDER BY line_no LIMIT ?`
    )
    .all(q.song_id, q.start_line_no, count);
  res.json({ lines: lines.map((l) => l.text) });
});

// Wipes your own quiz history — attempts and sessions — so Song Knowledge,
// History, and Leaderboard eligibility all reset to zero. Ratings and your
// song checklist live in separate tables and are untouched.
app.delete('/api/history', requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  await db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM quiz_sessions WHERE user_id = ?').run(userId);
  res.json({ ok: true });
});

// History: daily totals + accuracy by question type. "Accuracy" here is
// points-earned over points-possible per attempt, not a correct/wrong
// count — a raw correct count treats a cold, confident answer the same as
// a lucky 4-choice guess or a lyric answer given only after peeking at
// extra context, both of which already earn fewer points (see QuizPage.jsx's
// TYPE_POINTS/LYRIC_REVEAL_POINTS/CHOICE_FALLBACK_POINTS) — points-vs-max is
// the truer "did you actually know this" signal.
const MAX_POINTS_SQL = `SUM(CASE question_type WHEN 'audio' THEN 45 WHEN 'lyric' THEN 50 ELSE 40 END)`;
app.get('/api/history', requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  // active_song_count comes from the session an attempt belongs to; attempts
  // from before session tracking existed (session_id NULL) group together
  // under a null count rather than being dropped.
  const daily = await db
    .prepare(
      `SELECT date(a.played_at) as day, s.active_song_count as active_song_count,
              SUM(a.points) as points, COUNT(*) as attempts, ${MAX_POINTS_SQL} as max_points
       FROM quiz_attempts a LEFT JOIN quiz_sessions s ON s.id = a.session_id
       WHERE a.user_id = ? GROUP BY day, active_song_count ORDER BY day`
    )
    .all(userId);
  const byType = await db
    .prepare(
      `SELECT question_type, COUNT(*) as attempts, SUM(points) as points, ${MAX_POINTS_SQL} as max_points
       FROM quiz_attempts WHERE user_id = ? GROUP BY question_type`
    )
    .all(userId);
  res.json({ daily, byType });
});

// A "did you know" trivia snippet for a song, shown after answering
app.get('/api/songs/:id/trivia', requireAuth, async (req, res) => {
  res.json(await randomTriviaForSong(Number(req.params.id)));
});

// Full song detail: lyrics + easter eggs, for the browsable song list
app.get('/api/songs/:slug/detail', async (req, res) => {
  const song = await db
    .prepare(
      `SELECT s.*, a.name as album_name FROM songs s LEFT JOIN albums a ON a.id = s.album_id WHERE s.slug = ?`
    )
    .get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const ratingRow = await db
    .prepare('SELECT rating FROM user_song_ratings WHERE song_id = ? AND user_id = ?')
    .get(song.id, currentUserId(req));
  song.rating = ratingRow?.rating ?? 0;
  const lyrics = await db.prepare('SELECT line_no, text, is_header FROM lyrics_lines WHERE song_id = ? ORDER BY line_no').all(song.id);
  const easterEggs = await db
    .prepare(
      `SELECT id, term, description, category, confidence, source_url, timestamp_sec
       FROM easter_eggs WHERE song_id = ? AND deleted = 0
       ORDER BY CASE WHEN timestamp_sec IS NULL THEN 1 ELSE 0 END, timestamp_sec, id`
    )
    .all(song.id);
  const clipRows = await db
    .prepare(
      `SELECT id, start_sec, duration_sec, file_path FROM questions
       WHERE song_id = ? AND type = 'audio' AND status != 'retired' ORDER BY start_sec`
    )
    .all(song.id);
  const clips = clipRows.map((c) => ({ ...c, audio_url: audioClipUrl(c.file_path) }));
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
app.put('/api/songs/:slug/lyrics', requireAdmin, async (req, res) => {
  const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const { text } = req.body;
  if (typeof text !== 'string') return res.status(400).json({ error: 'text (string) required' });

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  await db.prepare('DELETE FROM lyrics_lines WHERE song_id = ?').run(song.id);
  const insertLine = db.prepare('INSERT INTO lyrics_lines (song_id, line_no, text, is_header) VALUES (?, ?, ?, ?)');
  let lineNo = 0;
  for (const line of lines) {
    lineNo++;
    const isHeader =
      /^\[.*\]$/.test(line) ||
      /^(intro|outro|verse\s*\d*|chorus|pre-chorus|bridge|hook|refrain|interlude|breakdown|drop)s?:?\s*$/i.test(line);
    await insertLine.run(song.id, lineNo, line, isHeader ? 1 : 0);
  }

  const summary = await rebuildLyricQuestions();
  res.json({ lineCount: lines.length, ...summary });
});

// Soft-delete an easter egg you don't find useful. Any quiz question built
// from it is retired (not deleted, in case it has attempt history).
app.delete('/api/easter-eggs/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.prepare('UPDATE easter_eggs SET deleted = 1 WHERE id = ?').run(id);
  await db.prepare(`UPDATE questions SET status = 'retired' WHERE type = 'reference' AND easter_egg_id = ?`).run(id);
  res.json({ ok: true });
});

// Manually add a gem (easter egg / reference / wordplay / fact) from the song page.
const GEM_CATEGORIES = new Set(['easter_egg', 'reference', 'wordplay', 'fact']);
app.post('/api/songs/:slug/easter-eggs', requireAdmin, async (req, res) => {
  const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const { term, description, category, confidence, quizzable, source_url, timestamp_sec } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });
  const timestampValue = Number.isInteger(timestamp_sec) && timestamp_sec >= 0 ? timestamp_sec : null;
  const info = await db
    .prepare(
      `INSERT INTO easter_eggs (song_id, term, description, category, confidence, quizzable, source_url, timestamp_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      song.id,
      term || null,
      description,
      GEM_CATEGORIES.has(category) ? category : 'easter_egg',
      confidence === 'confirmed' ? 'confirmed' : 'theory',
      quizzable ? 1 : 0,
      source_url || null,
      timestampValue
    );
  if (quizzable && term) {
    await db.prepare(`INSERT INTO questions (type, song_id, easter_egg_id) VALUES ('reference', ?, ?)`).run(song.id, info.lastInsertRowid);
  }
  res.status(201).json({ id: info.lastInsertRowid });
});

// Retire a single quiz question (e.g. one bad audio clip) without touching
// the rest of the song's data. Soft-delete, consistent with the calibration
// feedback's "not relevant" action.
app.delete('/api/questions/:id', requireAdmin, async (req, res) => {
  await db.prepare(`UPDATE questions SET status = 'retired' WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

// Permanently remove a song (e.g. a duplicate) and everything tied to it —
// lyrics, questions, easter eggs. Any past quiz_attempts referencing it are
// preserved but detached (song_id set null) rather than deleted, so your
// score history stays intact. Other songs' follow_up_to pointing at this one
// are cleared too.
app.delete('/api/songs/:slug', requireAdmin, async (req, res) => {
  const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const id = song.id;
  try {
    await withTransaction(async (tdb) => {
      await tdb.prepare('UPDATE quiz_attempts SET song_id = NULL WHERE song_id = ?').run(id);
      await tdb.prepare(
        `UPDATE quiz_attempts SET question_id = NULL WHERE question_id IN (SELECT id FROM questions WHERE song_id = ?)`
      ).run(id);
      await tdb.prepare('UPDATE songs SET follow_up_to_id = NULL WHERE follow_up_to_id = ?').run(id);
      await tdb.prepare(
        `DELETE FROM questions WHERE easter_egg_id IN (SELECT id FROM easter_eggs WHERE song_id = ?)`
      ).run(id);
      await tdb.prepare('DELETE FROM easter_eggs WHERE song_id = ?').run(id);
      await tdb.prepare('DELETE FROM user_song_ratings WHERE song_id = ?').run(id);
      await tdb.prepare('DELETE FROM user_songs WHERE song_id = ?').run(id);
      await tdb.prepare('DELETE FROM questions WHERE song_id = ?').run(id);
      await tdb.prepare('DELETE FROM lyrics_lines WHERE song_id = ?').run(id);
      await tdb.prepare('DELETE FROM songs WHERE id = ?').run(id);
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true });
});

// Set your song ranking in one shot: ranked_song_ids is an ordered list,
// most-preferred first — index 0 becomes rating 999, index 1 becomes 998,
// and so on. Anything not in the list (dragged back out, or never ranked)
// is reset to 0, the same "not rated" value everywhere else already treats
// as the default (see GET /api/songs?stats=1's COALESCE). Replaces the old
// per-song free-text PUT /api/songs/:slug/rating — the whole point of a
// ranked list is that scores are derived from relative order, not typed in
// one at a time, so there's no longer a single-song write path.
app.put('/api/ratings', requireAuth, async (req, res) => {
  const ids = req.body.ranked_song_ids;
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ error: 'ranked_song_ids must be an array of positive integers' });
  }
  if (new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: 'ranked_song_ids must not contain duplicates' });
  }
  const userId = currentUserId(req);
  const statements = [{ sql: 'UPDATE user_song_ratings SET rating = 0 WHERE user_id = ?', args: [userId] }];
  for (let i = 0; i < ids.length; i++) {
    statements.push({
      sql: `INSERT INTO user_song_ratings (user_id, song_id, rating) VALUES (?, ?, ?)
            ON CONFLICT(user_id, song_id) DO UPDATE SET rating = excluded.rating`,
      args: [userId, ids[i], 999 - i],
    });
  }
  await batchWrite(statements);
  res.json({ ok: true });
});

app.put('/api/songs/:slug/title', requireAdmin, async (req, res) => {
  const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    await db.prepare('UPDATE songs SET title = ? WHERE id = ?').run(title, song.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true, title });
});

// Assign (or create) the album a song belongs to. Lets a new collab album
// like "Busking Sessions (The Big Push)" be created just by typing its name
// on any of its songs, same as how titles get renamed one at a time.
app.put('/api/songs/:slug/album', requireAdmin, async (req, res) => {
  const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const name = (req.body.album || '').trim();
  if (!name) {
    await db.prepare('UPDATE songs SET album_id = NULL WHERE id = ?').run(song.id);
    return res.json({ ok: true, album: null });
  }
  await db.prepare('INSERT INTO albums (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
  const album = await db.prepare('SELECT id FROM albums WHERE name = ?').get(name);
  await db.prepare('UPDATE songs SET album_id = ? WHERE id = ?').run(album.id, song.id);
  res.json({ ok: true, album: name });
});

app.put('/api/songs/:slug/youtube-url', requireAdmin, async (req, res) => {
  const song = await db.prepare('SELECT id FROM songs WHERE slug = ?').get(req.params.slug);
  if (!song) return res.status(404).json({ error: 'not found' });
  const url = (req.body.youtube_url || '').trim() || null;
  await db.prepare('UPDATE songs SET youtube_url = ? WHERE id = ?').run(url, song.id);
  res.json({ ok: true, youtube_url: url });
});

// Word/name lookup across lyrics — whole-word match (so "rain" doesn't hit
// "trainer"). SQLite LIKE has no word-boundary concept, so we pre-filter
// broadly with LIKE (cheap, uses the text index) then apply a real regex
// boundary check in JS.
app.get('/api/lookup', async (req, res) => {
  const word = (req.query.word || '').trim();
  if (!word) return res.json([]);
  const candidates = await db
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

// Cross-song reference-term glossary shown at the bottom of Lyric Lookup —
// public, matching the rest of that page.
app.get('/api/reference-terms', async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT rt.term as term, s.title as title, s.slug as slug
       FROM reference_terms rt
       JOIN reference_term_songs rts ON rts.term_id = rt.id
       JOIN songs s ON s.id = rts.song_id
       ORDER BY rt.term COLLATE NOCASE, s.title`
    )
    .all();
  const byTerm = new Map();
  for (const r of rows) {
    if (!byTerm.has(r.term)) byTerm.set(r.term, { term: r.term, songs: [] });
    byTerm.get(r.term).songs.push({ title: r.title, slug: r.slug });
  }
  res.json([...byTerm.values()]);
});

// Add one song under a term — find-or-create the term (case-insensitive),
// then link the song. ON CONFLICT DO NOTHING so re-adding the same
// term/song pair is a harmless no-op rather than an error.
app.post('/api/reference-terms', requireAdmin, async (req, res) => {
  const term = (req.body.term || '').trim();
  const songTitle = (req.body.song_title || '').trim();
  if (!term || !songTitle) return res.status(400).json({ error: 'term and song_title required' });
  const song = await db.prepare('SELECT id FROM songs WHERE title = ? COLLATE NOCASE').get(songTitle);
  if (!song) return res.status(404).json({ error: 'no song with that exact title' });

  await db.prepare('INSERT INTO reference_terms (term) VALUES (?) ON CONFLICT(term) DO NOTHING').run(term);
  const termRow = await db.prepare('SELECT id FROM reference_terms WHERE term = ? COLLATE NOCASE').get(term);
  await db
    .prepare('INSERT INTO reference_term_songs (term_id, song_id) VALUES (?, ?) ON CONFLICT(term_id, song_id) DO NOTHING')
    .run(termRow.id, song.id);
  res.status(201).json({ ok: true });
});

// Per-song accuracy broken down into lyrics / audio-clip / other-fact
// questions, for the "Song Knowledge" practice view. Deliberately NOT the
// points-weighted scheme /api/history uses — this is meant to answer "do I
// know this song," so each question is worth exactly 1 regardless of type
// or how it was answered, not weighted by how much it happened to be worth.
app.get('/api/stats/songs', requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const rows = await db
    .prepare(
      `SELECT song_id, question_type, COUNT(*) as attempts, SUM(was_correct) as correct
       FROM quiz_attempts WHERE user_id = ? AND song_id IS NOT NULL GROUP BY song_id, question_type`
    )
    .all(userId);
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

  const ratingRows = await db.prepare('SELECT song_id, rating FROM user_song_ratings WHERE user_id = ?').all(userId);
  const ratings = new Map(ratingRows.map((r) => [r.song_id, r.rating]));
  const knownRows = await db.prepare('SELECT song_id FROM user_songs WHERE user_id = ?').all(userId);
  const knownIds = new Set(knownRows.map((r) => r.song_id));
  const songs = await db.prepare('SELECT id, title, slug FROM songs ORDER BY title').all();
  res.json(
    songs.map((s) => ({
      title: s.title,
      slug: s.slug,
      rating: ratings.get(s.id) ?? 0,
      known: knownIds.has(s.id),
      ...(bySong.get(s.id) ?? {
        lyrics: { correct: 0, total: 0 },
        video: { correct: 0, total: 0 },
        other: { correct: 0, total: 0 },
      }),
    }))
  );
});

// Leaderboard: (sum of points earned) * (songs checked / 2), from each
// user's best COMPLETED session of the standard SESSION_LENGTH only — a
// session only counts once all of its questions were actually answered, so
// shorter/partial sessions don't count here (they still show up in that
// user's own History, just not here). Points themselves already carry the
// per-type constants (see QuizPage.jsx's TYPE_POINTS), so this is just
// scaling a completed session's total by how large a pool it was drawn from.
app.get('/api/leaderboard', async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT s.user_id as user_id, u.display_name as name, s.id as session_id, s.active_song_count as active_song_count,
              SUM(a.points) as session_points, COUNT(a.id) as answered
       FROM quiz_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN quiz_attempts a ON a.session_id = s.id
       WHERE s.requested_count = ?
       GROUP BY s.id
       HAVING answered = ?`
    )
    .all(SESSION_LENGTH, SESSION_LENGTH);

  const best = new Map();
  for (const r of rows) {
    const score = Math.round((r.active_song_count / 2) * r.session_points);
    const prev = best.get(r.user_id);
    if (!prev || score > prev.score) {
      best.set(r.user_id, {
        user_id: r.user_id,
        name: r.name,
        score,
        active_song_count: r.active_song_count,
        points: r.session_points,
        session_id: r.session_id,
      });
    }
  }

  const entries = [...best.values()].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_LIMIT);
  res.json({ session_length: SESSION_LENGTH, limit: LEADERBOARD_LIMIT, entries });
});

// Question-by-question drilldown for one leaderboard entry's best session —
// public, matching the Leaderboard itself (see GET /api/leaderboard).
app.get('/api/leaderboard/:sessionId/attempts', async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId)) return res.status(400).json({ error: 'invalid session id' });
  const rows = await db
    .prepare(
      `SELECT question_type, correct_answer, user_answer, mode, was_correct, points
       FROM quiz_attempts WHERE session_id = ? ORDER BY id`
    )
    .all(sessionId);
  res.json(rows);
});

// Vercel's runtime invokes the exported app directly per-request rather
// than through a bound port, so skip listening there (process.env.VERCEL
// is set automatically in that environment) — local dev and any other
// host that just runs this file directly still get a real listening server.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`renquiz API listening on http://localhost:${PORT}`));
}

export default app;
