import { Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import LoginPage from './pages/LoginPage';
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/game/:roomId" element={<App />} />
      <Route path="/" element={<App />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
