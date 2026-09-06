// Google ID token verification + our own session JWT. Kept separate from
// server/auth.js, which stays the thin "who is this request from" seam
// every route already calls — this module is what fills that in.
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { db, withTransaction } from './db.js';
import { generateUniqueDisplayName } from './lib/randomDisplayName.js';
import { DEFAULT_SONG_SLUGS, DEFAULT_PREFERENCES } from './lib/defaults.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const SESSION_COOKIE_NAME = 'renquiz_session';
export const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
  return ticket.getPayload(); // { sub, email, name, picture, ... }
}

// Checked-songs + quiz-mix starting point for any brand-new account, guest
// or real alike — without this, a fresh account's checklist is empty and
// the quiz refuses to run at all until you visit Profile and hand-pick
// songs first (see needsOnboarding in QuizPage.jsx). Best-effort: an unknown
// slug (catalog drifted since this list was written) is just skipped rather
// than failing account creation over it.
async function seedDefaultsForNewUser(userId) {
  const songs = await db
    .prepare(`SELECT id FROM songs WHERE slug IN (${DEFAULT_SONG_SLUGS.map(() => '?').join(',')})`)
    .all(...DEFAULT_SONG_SLUGS);
  for (const song of songs) {
    await db.prepare('INSERT OR IGNORE INTO user_songs (user_id, song_id) VALUES (?, ?)').run(userId, song.id);
  }
  await db
    .prepare(
      `INSERT INTO user_preferences (user_id, audio_pct, lyric_pct, trivia_pct, expert_mode) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`
    )
    .run(userId, DEFAULT_PREFERENCES.audio_pct, DEFAULT_PREFERENCES.lyric_pct, DEFAULT_PREFERENCES.trivia_pct, 0);
}

// A real `users` row like any other, just never linked to a Google account.
// Lets someone use the whole app — quiz, history, ratings, preferences, all
// of it — with zero signup friction, since very few visitors were ever
// going to make an account first (see the design discussion this came out
// of). Tied to a normal long-lived session cookie, so it persists across
// visits in the same browser exactly like a real account would; it's only
// "lost" the way any cookie is (cleared, incognito, different browser/
// device) — signing in with Google later upgrades it in place, carrying the
// guest's data along (see migrateGuestToUser below).
export async function createGuestUser() {
  const displayName = await generateUniqueDisplayName(async (candidate) => {
    const existing = await db.prepare('SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE').get(candidate);
    return !!existing;
  });
  const info = await db
    .prepare(`INSERT INTO users (name, display_name, role, is_guest) VALUES (?, ?, 'user', 1)`)
    .run(displayName, displayName);
  const user = { id: info.lastInsertRowid, name: displayName, display_name: displayName, role: 'user', is_guest: 1 };
  await seedDefaultsForNewUser(user.id);
  return user;
}

// Matches by google_sub first (returning user), then by email — this is
// what lets vince's pre-existing seed row (id 1, all his real history)
// get *claimed* by his Google account on first sign-in instead of him
// ending up with a second, empty account. Reports whether the row is
// brand new so the caller (POST /api/auth/google) knows whether merging a
// prior guest session's data in is even safe to attempt.
export async function findOrCreateUser({ sub, email, name, picture }) {
  let user = await db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub);
  if (user) return { ...user, isNew: false };

  user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    await db.prepare('UPDATE users SET google_sub = ?, name = ?, picture_url = ? WHERE id = ?').run(sub, name, picture ?? null, user.id);
    return { ...user, google_sub: sub, name, picture_url: picture ?? null, isNew: false };
  }

  const displayName = await generateUniqueDisplayName(async (candidate) => {
    const existing = await db.prepare('SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE').get(candidate);
    return !!existing;
  });
  const info = await db
    .prepare(`INSERT INTO users (name, display_name, email, google_sub, picture_url, role) VALUES (?, ?, ?, ?, ?, 'user')`)
    .run(name, displayName, email, sub, picture ?? null);
  await seedDefaultsForNewUser(info.lastInsertRowid);
  return {
    id: info.lastInsertRowid,
    name,
    display_name: displayName,
    email,
    google_sub: sub,
    role: 'user',
    picture_url: picture ?? null,
    isNew: true,
  };
}

// Folds a guest's data into a real account that was just created in this
// same sign-in (isNew — see findOrCreateUser), then removes the now-fully-
// unreferenced guest row. Only ever called for a brand-new real account:
// merging into an *existing* one risks real conflicts (a differing rating
// on a song both touched, etc.) that aren't worth the complexity for what's
// a rare edge case (a guest happening to already have a real account) —
// that guest session's data is simply left behind, orphaned but harmless,
// same as any other abandoned row in this app.
export async function migrateGuestToUser(guestId, realUserId) {
  await withTransaction(async (tdb) => {
    // The real account was just seeded with the same defaults the guest
    // got (see findOrCreateUser -> seedDefaultsForNewUser) — clear that out
    // first, both so reassigning the guest's rows below doesn't collide on
    // a duplicate (user_id, song_id) primary key, and so whatever the guest
    // had actually changed (a different checklist, a different quiz mix)
    // wins over the fresh defaults instead of silently being discarded.
    await tdb.prepare('DELETE FROM user_songs WHERE user_id = ?').run(realUserId);
    await tdb.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(realUserId);
    await tdb.prepare('UPDATE user_songs SET user_id = ? WHERE user_id = ?').run(realUserId, guestId);
    await tdb.prepare('UPDATE user_song_ratings SET user_id = ? WHERE user_id = ?').run(realUserId, guestId);
    await tdb.prepare('UPDATE user_preferences SET user_id = ? WHERE user_id = ?').run(realUserId, guestId);
    await tdb.prepare('UPDATE quiz_sessions SET user_id = ? WHERE user_id = ?').run(realUserId, guestId);
    await tdb.prepare('UPDATE quiz_attempts SET user_id = ? WHERE user_id = ?').run(realUserId, guestId);
    await tdb.prepare('DELETE FROM users WHERE id = ?').run(guestId);
  });
}

// Role (and now is_guest) ride in the token itself rather than a per-request
// DB lookup — cheap, at the cost of a promotion (or a guest-to-real upgrade)
// only taking effect on that person's next sign-in, not instantly.
export function signSession(user) {
  return jwt.sign({ userId: user.id, role: user.role, isGuest: !!user.is_guest }, process.env.SESSION_JWT_SECRET, {
    expiresIn: '30d',
  });
}

export function verifySession(token) {
  try {
    return jwt.verify(token, process.env.SESSION_JWT_SECRET);
  } catch {
    return null;
  }
}
