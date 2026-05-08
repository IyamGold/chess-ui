import { Routes, Route } from 'react-router-dom';
import App from './App.jsx';
import LoginPage from './pages/LoginPage.jsx';
import McpConsentPage from './pages/McpConsentPage.jsx';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mcp/consent" element={<McpConsentPage />} />
      <Route path="/*" element={<App />} />
    </Routes>
  );
}
