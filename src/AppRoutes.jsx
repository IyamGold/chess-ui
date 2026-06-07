import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import App from './App.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import SigninRequiredPage from './pages/SigninRequiredPage.jsx';

// Compatibility redirect: /mcp/consent → /auth (preserve query string).
function ConsentRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/auth${search}`} replace />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/signin-required" element={<SigninRequiredPage />} />
      <Route path="/mcp/consent" element={<ConsentRedirect />} />
      <Route path="/game/:roomId" element={<App />} />
      <Route path="/*" element={<App />} />
    </Routes>
  );
}
