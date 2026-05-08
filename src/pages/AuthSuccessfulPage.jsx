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
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Connected</h1>
        {url ? (
          <>
            <p className="auth-msg">Returning you to your AI client…</p>
            <p className="auth-sub">If nothing happens in a moment, <a href={url}>click here</a>.</p>
          </>
        ) : (
          <p className="auth-error">Missing redirect URL. The authorization completed but we don't know where to send you.</p>
        )}
      </div>
    </div>
  );
}
