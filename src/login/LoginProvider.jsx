import { useEffect, useState } from 'react';
import { Context } from './context';
export function LoginProvider({ children }) {
  const [profile, setProfile] = useState(null),
    [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const response = await fetch('/api/login/session');
      setProfile(response.ok ? await response.json() : null);
    } catch {
      setProfile(null);
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
