import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './AuthPages.css';

// Validate redirect_url: must be an absolute http(s) URL the AS already
// emitted back to us. Treat unknown shapes as untrusted and bail.
function safeRedirectUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export default function AuthSuccessfulPage() {
  const location = useLocation();
  const url = safeRedirectUrl(new URLSearchParams(location.search).get('redirect_url'));

  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => window.location.assign(url), 800);
    return () => clearTimeout(t);
  }, [url]);

  return (
    <div className="auth-page auth-success">
      <div className="auth-success__content">
        <h1 className="auth-success__title">Authentication Successful</h1>
        <p className="auth-success__sub">You can now close this tab and return to claude code.</p>
      </div>
    </div>
  );
}
