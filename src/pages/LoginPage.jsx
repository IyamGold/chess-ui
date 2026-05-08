import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AuthGate from '../components/AuthGate';
import { usePasskeyAuth } from '../hooks/usePasskeyAuth';

// Validate and sanitize the return_to query param. Must be a same-origin
// relative path (starts with `/`, no protocol-relative `//`).
function parseReturnTo(search) {
  const raw = new URLSearchParams(search).get('return_to');
  if (!raw) return '/';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export default function LoginPage() {
  const passkey = usePasskeyAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = parseReturnTo(location.search);

  // Already authenticated? Skip the gate.
  useEffect(() => {
    if (passkey.isAuthenticated) {
      navigate(returnTo, { replace: true });
    }
  }, [passkey.isAuthenticated, returnTo, navigate]);

  // Wrap signup/login so we navigate after they resolve. AuthGate already
  // surfaces errors from the rejected promises.
  const handleSignup = async (username) => {
    await passkey.signup(username);
    navigate(returnTo, { replace: true });
  };
  const handleLogin = async () => {
    await passkey.login();
    navigate(returnTo, { replace: true });
  };

  return <AuthGate onSignup={handleSignup} onLogin={handleLogin} />;
}
