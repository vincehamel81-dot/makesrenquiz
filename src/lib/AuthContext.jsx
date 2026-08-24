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
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isAdmin: user?.role === 'admin', checking, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
