// Google ID token verification + our own session JWT. Kept separate from
// server/auth.js, which stays the thin "who is this request from" seam
// every route already calls — this module is what fills that in.
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const SESSION_COOKIE_NAME = 'renquiz_session';
export const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
  return ticket.getPayload(); // { sub, email, name, picture, ... }
}

// Matches by google_sub first (returning user), then by email — this is
// what lets vince's pre-existing seed row (id 1, all his real history)
// get *claimed* by his Google account on first sign-in instead of him
// ending up with a second, empty account.
export async function findOrCreateUser({ sub, email, name, picture }) {
  let user = await db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub);
  if (user) return user;

  user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    await db.prepare('UPDATE users SET google_sub = ?, name = ?, picture_url = ? WHERE id = ?').run(sub, name, picture ?? null, user.id);
    return { ...user, google_sub: sub, name, picture_url: picture ?? null };
  }

  const info = await db
    .prepare(`INSERT INTO users (name, email, google_sub, picture_url, role) VALUES (?, ?, ?, ?, 'user')`)
    .run(name, email, sub, picture ?? null);
  return { id: info.lastInsertRowid, name, email, google_sub: sub, role: 'user', picture_url: picture ?? null };
}

// Role rides in the token itself rather than a per-request DB lookup —
// cheap, at the cost of a promotion only taking effect on that person's
// next sign-in, not instantly.
export function signSession(user) {
  return jwt.sign({ userId: user.id, role: user.role }, process.env.SESSION_JWT_SECRET, { expiresIn: '30d' });
}

export function verifySession(token) {
  try {
    return jwt.verify(token, process.env.SESSION_JWT_SECRET);
  } catch {
    return null;
  }
}
