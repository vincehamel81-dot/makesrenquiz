-- Accounts. google_sub is Google's stable per-account id, set on first
-- real sign-in (see server/auth/google.js) — null until then. The seed row
-- (id 1 = vince) is matched by email on his first Google sign-in rather
-- than getting a second row, so his existing history/ratings/checklist
-- carry over intact.
-- name is the real Google account name — never shown to other users.
-- display_name is the public username shown in the topbar and Leaderboard:
-- alphanumeric only, 3-15 chars, unique (case-insensitive). Defaults to a
-- random two-word name at signup (see server/lib/randomDisplayName.js) and
-- is user-editable from Profile (PUT /api/profile).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_name TEXT,
  email TEXT UNIQUE,
  google_sub TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  picture_url TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name COLLATE NOCASE);
INSERT OR IGNORE INTO users (id, name, display_name, email, role) VALUES (1, 'vince', 'Vince', 'vince.hamel81@gmail.com', 'admin');

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  release_date TEXT
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  album_id INTEGER REFERENCES albums(id),
  release_date TEXT,
  collaborators TEXT,      -- JSON array of strings
  themes TEXT,              -- JSON array of strings
  follow_up_to_id INTEGER REFERENCES songs(id),
  youtube_url TEXT,
  duration_sec REAL,
  notes TEXT
);

-- Per-user preference rating (0-1000). Split out from `songs` so more than
-- one person's ratings can coexist once there's real auth.
CREATE TABLE IF NOT EXISTS user_song_ratings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  song_id INTEGER NOT NULL REFERENCES songs(id),
  rating INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, song_id)
);

-- Which songs a user wants to be quizzed on. Presence = checked; an empty
-- set for a user is the "never onboarded" signal the quiz gate checks for.
CREATE TABLE IF NOT EXISTS user_songs (
  user_id INTEGER NOT NULL REFERENCES users(id),
  song_id INTEGER NOT NULL REFERENCES songs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, song_id)
);

-- Per-user audio/lyric/trivia quiz mix. Missing row = use the default
-- (60/38/2, matching the previous global constant) — only created once a
-- user actually saves a custom ratio.
-- expert_mode: audio questions draw from the 'hard' clip pool instead of
-- 'normal' (see questions.difficulty), and audio points double. Global
-- per-user toggle, not per-song — lyrics/bio are unaffected for now.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  audio_pct INTEGER NOT NULL,
  lyric_pct INTEGER NOT NULL,
  trivia_pct INTEGER NOT NULL,
  expert_mode INTEGER NOT NULL DEFAULT 0,
  CHECK (audio_pct + lyric_pct + trivia_pct = 100)
);

-- One row per "Start Quiz" click — the snapshot a session was generated
-- under, so History can group by it and the Leaderboard can tell whether a
-- session was actually completed in full.
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  requested_count INTEGER NOT NULL,
  active_song_count INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cross-song reference-term glossary shown on Lyric Lookup — deliberately
-- separate from easter_eggs' 'reference' category (which is a note on ONE
-- song); this is "term X shows up across songs A, B, C," built up manually
-- via the page's own add form rather than derived from gem data.
CREATE TABLE IF NOT EXISTS reference_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_terms_term ON reference_terms(term COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS reference_term_songs (
  term_id INTEGER NOT NULL REFERENCES reference_terms(id),
  song_id INTEGER NOT NULL REFERENCES songs(id),
  PRIMARY KEY (term_id, song_id)
);

CREATE TABLE IF NOT EXISTS lyrics_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  line_no INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_header INTEGER NOT NULL DEFAULT 0 -- section markers like [Chorus], shown in the lyrics view but never asked as quiz questions
);
CREATE INDEX IF NOT EXISTS idx_lyrics_lines_song ON lyrics_lines(song_id);
CREATE INDEX IF NOT EXISTS idx_lyrics_lines_text ON lyrics_lines(text);

-- Materialized question bank. One row = one concrete, askable question instance.
-- 'audio' rows carry start/duration; 'lyric' rows carry a line range into lyrics_lines;
-- the other types (theme/follow-up/album/collaborator/bio) are single-instance facts
-- derived from songs/albums/bio_facts, backfilled once and rated the same way.
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('audio','lyric','theme','follow-up','album','collaborator','bio','reference')),
  song_id INTEGER REFERENCES songs(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','retired')),
  -- audio-only
  start_sec REAL,
  duration_sec REAL DEFAULT 5,
  file_path TEXT,
  -- audio-only: 'hard' clips are the short, no-context Expert Mode pool
  -- (see user_preferences.expert_mode) — a separate set of rows per song,
  -- not a difficulty tier applied to the existing 'normal' ones.
  difficulty TEXT NOT NULL DEFAULT 'normal' CHECK(difficulty IN ('normal','hard')),
  -- lyric-only
  start_line_no INTEGER,
  context_lines INTEGER DEFAULT 1,
  -- theme/collaborator: which entry in the song's JSON array this row is about
  fact_key TEXT,
  -- bio-only
  bio_fact_id INTEGER REFERENCES bio_facts(id),
  -- reference-only
  easter_egg_id INTEGER REFERENCES easter_eggs(id),
  -- non-audio/lyric sampling weight, nudged by too-hard/too-easy feedback
  weight REAL NOT NULL DEFAULT 1,
  times_asked INTEGER NOT NULL DEFAULT 0,
  times_correct INTEGER NOT NULL DEFAULT 0,
  last_asked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_type_status ON questions(type, status);
CREATE INDEX IF NOT EXISTS idx_questions_song ON questions(song_id);

CREATE TABLE IF NOT EXISTS bio_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  options TEXT -- JSON array of plausible wrong answers, e.g. other birth years; null falls back to other bio answers as distractors
);

-- Hidden references, wordplay, and lore per song ("easter eggs", shown to
-- users as "Gems"). Not every entry becomes a quiz question (quizzable=1
-- only for crisp, single-term ones like "Calamity" -> Hold On) but all are
-- shown on the song detail page. category splits the five kinds of gem
-- (easter_egg = hidden in the audio/video itself, reference = callback to
-- another song, wordplay = double entendre/pun, fact = song-specific
-- trivia not about Ren generally — see bio_facts for that, analysis = a
-- longer written breakdown, shown last regardless of timestamp since it
-- isn't a "moment in the song" the way the others are) — existing rows
-- default to easter_egg since that's what this table originally only held.
CREATE TABLE IF NOT EXISTS easter_eggs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  term TEXT,
  description TEXT NOT NULL,
  timestamp_sec INTEGER, -- where in the video/audio this happens, for MM:SS display and jump-to-timestamp; null = untimed
  category TEXT NOT NULL DEFAULT 'easter_egg' CHECK(category IN ('easter_egg','reference','wordplay','fact','analysis')),
  confidence TEXT NOT NULL DEFAULT 'theory' CHECK(confidence IN ('confirmed','theory')),
  quizzable INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_easter_eggs_song ON easter_eggs(song_id);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
  session_id INTEGER REFERENCES quiz_sessions(id),
  played_at TEXT NOT NULL DEFAULT (datetime('now')),
  question_type TEXT NOT NULL,
  question_id INTEGER REFERENCES questions(id),
  song_id INTEGER REFERENCES songs(id),
  prompt TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  user_answer TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('free','choice')),
  was_correct INTEGER NOT NULL CHECK(was_correct IN (0,1)),
  points INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_played_at ON quiz_attempts(played_at);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON quiz_attempts(user_id);
