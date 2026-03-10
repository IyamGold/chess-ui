import { useState, useEffect, useCallback } from 'react';
import { GAME_SERVER_URL } from '../config';
const LS_TOKEN_KEY = 'server_auth_token';

export function useServerAuth({ isAuthenticated, account, username }) {
  const [serverToken, setServerToken] = useState(() => localStorage.getItem(LS_TOKEN_KEY));
  const [isConnected, setIsConnected] = useState(() => !!localStorage.getItem(LS_TOKEN_KEY));

  // Bridge passkey auth to server token — also validates/re-bridges stale tokens
  useEffect(() => {
    if (!isAuthenticated || !account || !username) {
      setServerToken(null);
      setIsConnected(false);
      localStorage.removeItem(LS_TOKEN_KEY);
      return;
    }

    let cancelled = false;

    async function ensureValidToken() {
      const existing = localStorage.getItem(LS_TOKEN_KEY);

      // If we have a stored token, validate it
      if (existing) {
        try {
          const resp = await fetch(`${GAME_SERVER_URL}/api/rooms`, {
            headers: { 'Authorization': `Bearer ${existing}` },
          });
          if (resp.ok) {
            // Token is valid
            if (!cancelled) {
              setServerToken(existing);
              setIsConnected(true);
            }
            return;
          }
        } catch {}
        // Token is stale/invalid — clear it and re-bridge
        localStorage.removeItem(LS_TOKEN_KEY);
      }

      // Bridge: get a new token from the server
      try {
        const resp = await fetch(`${GAME_SERVER_URL}/api/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passkeyAddress: account, username }),
        });

        if (!resp.ok) {
          console.error('Server auth bridge failed:', await resp.text());
          if (!cancelled) setIsConnected(false);
          return;
        }

        const data = await resp.json();
        if (!cancelled) {
          localStorage.setItem(LS_TOKEN_KEY, data.token);
          setServerToken(data.token);
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Server auth bridge error:', err);
        if (!cancelled) setIsConnected(false);
      }
    }

    ensureValidToken();
    return () => { cancelled = true; };
  }, [isAuthenticated, account, username]);

  const logout = useCallback(() => {
    localStorage.removeItem(LS_TOKEN_KEY);
    setServerToken(null);
    setIsConnected(false);
  }, []);

  return { serverToken, isConnected, logout };
}
