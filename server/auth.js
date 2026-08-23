// Single point of truth for "who is making this request." Hardcoded to the
// one user (vince, id 1 — see the seed row in schema.sql) since there's no
// auth yet. Wiring up real SSO later means changing only this function, not
// every route that reads/writes per-user data.
export function currentUserId(_req) {
  return 1;
}
