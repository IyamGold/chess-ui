import { Navigate } from 'react-router-dom';
import { useLogin } from '../login/context';
import './AuthPages.css';
export default function LoginPage() {
  const login = useLogin();
  if (login.loading)
    return (
      <main className="auth-gate">
        <p>Checking your game session…</p>
      </main>
    );
  if (login.isAuthenticated) return <Navigate to="/" replace />;
  const error = new URLSearchParams(location.search).has('error');
  return (
    <main className="auth-gate">
      <h1>Login Chess</h1>
      <p>Play a friend or challenge the computer.</p>
      <p>One Login account. Your passkey stays with Login.</p>
      {error && (
        <p role="alert">Sign-in was cancelled, expired, or unavailable. You can try again.</p>
      )}
      {login.serviceError ? (
        <>
          <p role="alert">{login.serviceError}</p>
          <button className="setup-start" onClick={() => void login.refresh()}>
            Try again
          </button>
        </>
      ) : (
        <a className="setup-start" href="/api/login/start">
          Continue with Login
        </a>
      )}
      <p>KYC is optional. This hackathon demo uses testnet money and sandbox verification only.</p>
    </main>
  );
}
