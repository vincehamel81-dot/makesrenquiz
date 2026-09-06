// Adds songs.live_youtube_url for the live-performance-video feature (see
// tools/addLiveVersion.js). Plain ADD COLUMN, no CHECK constraint involved.
import { db } from '../server/db.js';

await db.exec('ALTER TABLE songs ADD COLUMN live_youtube_url TEXT');
console.log('Added songs.live_youtube_url');
