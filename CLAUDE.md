# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal music-trivia quiz app for the discography of the artist Ren (renquiz). It quizzes on audio clip recognition, lyric snippets, and song facts (themes, collaborators, follow-ups, album, bio, easter-egg references), tracks attempt history, and lets you browse full lyrics/trivia per song.

Single-user, local-only right now. There's a `users` table but no real auth — `server/auth.js`'s `currentUserId()` hardcodes `1` (seeded as vince in `schema.sql`) for every request. Swapping in real SSO later means changing only that function; every route already reads/writes `quiz_attempts.user_id` and `user_song_ratings` through it.

## Commands

- `npm run dev` — runs client (Vite, port 5173) and API (`node --watch server/index.js`, port 3001) concurrently. Vite proxies `/api` and `/audio` to the API (`vite.config.js`).
- `npm run dev:client` / `npm run dev:server` — run just one side.
- `npm run build` / `npm run preview` — production client build/preview.
- `npm run lint` — oxlint (`.oxlintrc.json`; react + oxc plugin rules).
- No test suite exists yet.

### Data pipeline (run in order for a fresh DB, each step is re-runnable/idempotent)

1. `npm run seed:songs` → `tools/parseSongs.js` (reads `songs.txt`) → `tools/seedDb.js` (upserts `tools/songs.seed.json` + `tools/bio_facts.seed.json` into SQLite by slug) → `tools/syncFactQuestions.js` (backfills theme/collaborator/follow-up/album/bio question rows).
2. `npm run fetch:audio` → `tools/fetchAudio.js`. Matches each song against a cached full index of Ren's (and side-project) YouTube channels (`tools/channel_videos.json`), downloads raw audio to `audio_raw/<slug>.mp3` via yt-dlp, slices 8 clips per song into `public/audio/` via ffmpeg (`server/lib/clipAudio.js`), and inserts `type='audio'` question rows. Resumable — skips songs that already have `audio_raw/<slug>.mp3`, so fixing a bad match requires deleting that raw file (and the stale `public/audio/<slug>-*.mp3` files) before re-running. If `songs.youtube_url` is already set, it's trusted as manually-confirmed and skips the matcher entirely. Low-confidence/ambiguous matches are logged to `tools/audio_fetch_report.json` with `needsReview: true` instead of auto-downloading.
3. `npm run fetch:lyrics` → `tools/scrapeLyrics.js` (populates `lyrics_lines`) → `tools/selectLyricQuestions.js` (picks distinctive 1-2 line bundles per song, inserts `type='lyric'` question rows referencing line ranges, not copied text).

Other one-off tools: `tools/importRatings.js` (from `tools/ratings.csv`), `tools/backfillYoutubeUrls.js`, `tools/auditAudioDurations.js`.

## Architecture

**Storage**: `node:sqlite` (Node's built-in module, not better-sqlite3 or an ORM) — see `server/db.js`. DB file at `data/renquiz.db`, schema auto-applied from `server/schema.sql` on every boot (`CREATE TABLE IF NOT EXISTS`, so schema changes need a manual migration, not just an edit).

**Question bank model** (`server/schema.sql`): `questions` is a materialized bank — one row per concrete, askable question instance, not generated on the fly. `type` is one of `audio | lyric | theme | follow-up | album | collaborator | bio | reference`, each carrying only the columns it needs (`start_sec`/`file_path` for audio, `start_line_no`/`context_lines` for lyric, `fact_key`/`bio_fact_id`/`easter_egg_id` for the fact types). Rows have `status` (`pending`/`active`/`retired` — soft-delete instead of hard delete, to preserve attempt history) and adaptive-selection fields `weight`, `times_asked`, `times_correct`, `last_asked_at`.

**Question lifecycle**:
- Bank rows are built once by the data pipeline (or manually via feedback), never per-request.
- `server/questionTypes.js`: `generateSession(count)` does weighted-random sampling into fixed buckets (`audio: 60%, lyric: 38%, other: 2%` — `BUCKET_TARGET`), damping already-seen questions via a recency factor (`1/(1+times_asked)`, plus a penalty if asked within 72h). `hydrate()` turns a bank row into the actual `{prompt, correct_answer, ...}` sent to the client — lyric text is read fresh from `lyrics_lines` at hydrate time even though the *selection* of which lines was precomputed.
- `markAsked()` updates `times_asked`/`times_correct` after `POST /api/attempts` records the attempt.
- `server/feedback.js`: 4-action calibration loop (`perfect | too_hard | too_easy | not_relevant`) on a bank question — `too_hard`/`too_easy` step audio playback duration or lyric context lines along a fixed ladder (`AUDIO_DURATION_LADDER`/`LYRIC_MAX_CONTEXT`); the underlying clip file is always sliced generously up front, so difficulty changes are just playback-duration changes, no re-slicing.

**Server**: single-file Express app (`server/index.js`), no route-file split despite `server/routes/` existing as an empty placeholder. All endpoints are directly in that file — REST-ish resource routes under `/api/songs`, `/api/questions`, `/api/quiz`, `/api/attempts`, `/api/history`, `/api/stats`, `/api/lookup`. `/audio` is statically served from `public/audio`.

**Client**: React + Vite, `react-router-dom` for the 6 pages under `src/pages/` (Quiz, Songs list/detail, History, Song Knowledge, Lyric lookup), wired in `src/App.jsx`.

**Deletion semantics**: deleting a song (`DELETE /api/songs/:slug`) cascades to its lyrics/questions/easter-eggs but *detaches* (nulls `song_id`/`question_id` on, doesn't delete) any `quiz_attempts` referencing it — score history is meant to survive content changes underneath it.

**Per-user vs. shared data**: `quiz_attempts` (and thus `/api/history`, `/api/stats/songs`) and `user_song_ratings` are scoped by `user_id` via `currentUserId(req)`. Everything else — the question bank itself, including `weight`/`times_asked`/`times_correct` recency damping in `questionTypes.js` — is global/shared across all users, not personalized. That's a deliberate scope line for the current single-user setup, not an oversight.
