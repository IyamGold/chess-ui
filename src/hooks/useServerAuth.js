import { useState, useEffect, useCallback } from 'react';
import { GAME_SERVER_URL } from '../config';
const SS_TOKEN_KEY = 'server_auth_token';

export function useServerAuth({ isAuthenticated, account, username }) {
  const [serverToken, setServerToken] = useState(() => localStorage.getItem(SS_TOKEN_KEY));
  const [isConnected, setIsConnected] = useState(() => !!localStorage.getItem(SS_TOKEN_KEY));

  // When passkey auth state changes, bridge to server token
  useEffect(() => {
    if (!isAuthenticated || !account || !username) {
      setServerToken(null);
      setIsConnected(false);
      localStorage.removeItem(SS_TOKEN_KEY);
      return;
    }

    // If we already have a token in this session, skip
    const existing = localStorage.getItem(SS_TOKEN_KEY);
    if (existing) {
      setServerToken(existing);
      setIsConnected(true);
      return;
    }

    let cancelled = false;

    async function bridge() {
      try {
        const resp = await fetch(`${GAME_SERVER_URL}/api/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passkeyAddress: account, username }),
        });

        if (!resp.ok) {
          console.error('Server auth bridge failed:', await resp.text());
          return;
        }

        const data = await resp.json();
        if (!cancelled) {
          localStorage.setItem(SS_TOKEN_KEY, data.token);
          setServerToken(data.token);
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Server auth bridge error:', err);
        if (!cancelled) {
          setIsConnected(false);
        }
      }
    }

    bridge();
    return () => { cancelled = true; };
  }, [isAuthenticated, account, username]);

  const logout = useCallback(() => {
    localStorage.removeItem(SS_TOKEN_KEY);
    setServerToken(null);
    setIsConnected(false);
  }, []);

  return { serverToken, isConnected, logout };
}
