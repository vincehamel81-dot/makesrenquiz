-- Accounts. Single hardcoded row (id 1 = vince) for now — no auth yet, see
-- server/auth.js. Real SSO later only needs to fill this table in properly
-- and derive the id from a session instead of hardcoding it.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE
);
INSERT OR IGNORE INTO users (id, name, email) VALUES (1, 'vince', 'vince.hamel81@gmail.com');

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

-- Hidden references, wordplay, and lore per song ("easter eggs"). Not every
-- entry becomes a quiz question (quizzable=1 only for crisp, single-term
-- ones like "Calamity" -> Hold On) but all are shown on the song detail page.
CREATE TABLE IF NOT EXISTS easter_eggs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  term TEXT,
  description TEXT NOT NULL,
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
