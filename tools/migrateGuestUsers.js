// Adds users.is_guest for the guest-account feature (see server/googleAuth.js's
// createGuestUser). Plain ADD COLUMN — no CHECK constraint involved, so this
// doesn't need the rename-and-recreate dance a CHECK change would.
import { db } from '../server/db.js';

await db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
console.log('Added users.is_guest');
