// Vercel's entry point for the API — everything under /api/* (see
// vercel.json's rewrite) is routed to this single function, which is just
// the existing Express app re-exported. No routes are split into separate
// files; server/index.js's internal routing still does all the work.
export { default } from '../server/index.js';
