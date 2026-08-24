// Single point of truth for "who is making this request" and their role.
// req.userId/req.userRole are populated by the session-cookie middleware
// in server/index.js (see attachUser) — null here just means signed out;
// routes that require a signed-in (or admin) user use requireAuth /
// requireAdmin below, which run before a handler ever consults these.
export function currentUserId(req) {
  return req.userId ?? null;
}

export function currentUserRole(req) {
  return req.userRole ?? null;
}

export function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'login required' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'login required' });
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}
