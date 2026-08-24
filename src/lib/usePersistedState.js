import { useState } from 'react';

// Persists a small piece of UI state (a view toggle, a filter) in
// localStorage so it survives across visits. Falls back to plain in-memory
// state if localStorage isn't available (private browsing, etc).
export function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : JSON.parse(stored);
    } catch {
      return defaultValue;
    }
  });

  function setPersisted(next) {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // best-effort only
      }
      return resolved;
    });
  }

  return [value, setPersisted];
}
