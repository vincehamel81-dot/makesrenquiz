import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';

// Google's Identity Services script (loaded in index.html) attaches itself
// to window.google asynchronously — poll briefly rather than assuming it's
// ready by the time this component mounts.
export default function GoogleSignInButton() {
  const buttonRef = useRef(null);
  const { refresh } = useAuth();
  const { theme } = useTheme();

  useEffect(() => {
    let cancelled = false;

    async function handleCredential(response) {
      await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: response.credential }),
      });
      refresh();
    }

    function render() {
      if (cancelled || !buttonRef.current || !window.google?.accounts?.id) return;
      buttonRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleCredential,
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
      });
    }

    if (window.google?.accounts?.id) {
      render();
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          render();
        }
      }, 100);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }
  }, [refresh, theme]);

  return <div ref={buttonRef} />;
}
