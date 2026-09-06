import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = signed out, undefined = still checking
  const [checking, setChecking] = useState(true);

  function refresh() {
    return fetch('/api/me')
      .then((r) => r.json())
      .then(setUser);
  }

  useEffect(() => {
    refresh().finally(() => setChecking(false));
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // Not setUser(null) — the very next request (this one included) mints a
    // fresh guest account now that the cookie's cleared, so refresh() to
    // pick that up rather than showing a momentary signed-out flash for a
    // state the server won't actually be in.
    refresh();
  }

  return (
    <AuthContext.Provider
      value={{ user, isAdmin: user?.role === 'admin', isGuest: !!user?.is_guest, checking, refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
