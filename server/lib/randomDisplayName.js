// Username rules: alphanumeric only, 3-15 chars, unique (case-insensitive)
// across users — enforced by callers via `generateUniqueDisplayName` and by
// a COLLATE NOCASE unique index on users.display_name.
export const DISPLAY_NAME_PATTERN = /^[a-zA-Z0-9]{3,15}$/;

// Kept short (<=6 chars each) so every adjective+noun combo stays well
// under the 15-char limit, leaving room for a numeric suffix on collision.
const ADJECTIVES = [
  'Silent', 'Golden', 'Bitter', 'Faded', 'Quiet', 'Wild', 'Amber', 'Lucid',
  'Frozen', 'Bold', 'Dusky', 'Vivid', 'Rusty', 'Pale', 'Grim', 'Hazy',
  'Brave', 'Swift', 'Sharp', 'Sunny', 'Moody', 'Fierce', 'Gentle', 'Rebel',
];

const NOUNS = [
  'Fox', 'Comet', 'Wolf', 'Raven', 'Echo', 'Ember', 'Storm', 'Tide',
  'Falcon', 'Shadow', 'Ridge', 'Meadow', 'Harbor', 'Signal', 'Cipher', 'Anchor',
  'Spark', 'Coral', 'Delta', 'Mirage', 'Vessel', 'Compass', 'Lantern', 'Ranger',
];

// Two-word placeholder username assigned at signup so a real name is never
// shown to other users by default — Profile lets anyone override it.
export function randomDisplayName() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adjective}${noun}`;
}

// `isTaken(candidate)` is an async predicate the caller implements against
// its own DB connection — keeps this module DB-agnostic. Falls back to a
// timestamp-derived name if 20 random attempts all collide (astronomically
// unlikely at real user counts, but keeps this from looping forever).
export async function generateUniqueDisplayName(isTaken) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let candidate = randomDisplayName();
    if (attempt > 0) {
      const suffix = String(Math.floor(1000 + Math.random() * 9000));
      candidate = `${candidate.slice(0, 15 - suffix.length)}${suffix}`;
    }
    if (!(await isTaken(candidate))) return candidate;
  }
  return `User${Date.now().toString(36)}`.slice(0, 15);
}
