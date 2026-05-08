import { useLocation, useNavigate } from 'react-router-dom';
import './AuthPages.css';

export default function SigninRequiredPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestId = new URLSearchParams(location.search).get('request_id');

  // Without a request_id, this page wasn't reached from the OAuth flow.
  if (!requestId) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Sign in required</h1>
          <p className="auth-msg">
            Open onchainchess from your AI client to start.
          </p>
        </div>
      </div>
    );
  }

  const handleSignIn = () => {
    const returnTo = `/auth?request_id=${encodeURIComponent(requestId)}`;
    navigate(`/login?return_to=${encodeURIComponent(returnTo)}`);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Sign in required</h1>
        <p className="auth-msg">
          You'll need to sign in to onchainchess before connecting your AI client.
        </p>
        <p className="auth-sub">
          Don't have an account yet? You can sign up at the same time — it's free.
        </p>
        <button className="auth-btn auth-btn-primary" onClick={handleSignIn}>
          Sign in to onchainchess →
        </button>
      </div>
    </div>
  );
}
