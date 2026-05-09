import { useLocation, useNavigate } from 'react-router-dom';
import './AuthPages.css';

export default function SigninRequiredPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestId = new URLSearchParams(location.search).get('request_id');

  const handleSignIn = () => {
    const returnTo = requestId
      ? `/auth?request_id=${encodeURIComponent(requestId)}`
      : '/';
    navigate(`/login?return_to=${encodeURIComponent(returnTo)}`);
  };

  return (
    <div className="auth-page auth-screen">
      <div className="auth-screen__content">
        <h1 className="auth-screen__title">Sign in to continue</h1>
        <p className="auth-screen__sub">
          To authorize access you must first login or create an account.
        </p>
        <button className="auth-screen__btn" onClick={handleSignIn}>
          Sign in
        </button>
      </div>
    </div>
  );
}
