import { useEffect, useState } from 'react';
import { Context } from './context';
export function LoginProvider({ children }) {
  const [profile, setProfile] = useState(null),
    [loading, setLoading] = useState(true),
    [serviceError, setServiceError] = useState(null);
  const refresh = async () => {
    try {
      const response = await fetch('/api/login/session', { cache: 'no-store' });
      if (
        !response.headers.get('content-type')?.includes('application/json') ||
        (!response.ok && response.status !== 401)
      ) {
        throw new Error('Login service unavailable');
      }
      const data = await response.json();
      if (response.ok && (!Number.isSafeInteger(data?.id) || typeof data?.username !== 'string')) {
        throw new Error('Invalid game session');
      }
      setProfile(response.ok ? data : null);
      setServiceError(null);
    } catch {
      setProfile(null);
      setServiceError('Sign-in is temporarily unavailable. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const logout = async () => {
    const response = await fetch('/api/login/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error('Sign out failed. Try again.');
    setProfile(null);
  };
  return (
    <Context.Provider
      value={{
        profile,
        loading,
        serviceError,
        refresh,
        logout,
        isAuthenticated: !!profile,
        account: profile ? String(profile.id) : null,
        username: profile?.username,
      }}
    >
      {children}
    </Context.Provider>
  );
}
