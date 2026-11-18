import { Navigate, Route, Routes } from 'react-router-dom';
import { AccessDeniedPage, AccountsPage, LoginPage, NotFoundPage, RegisterPage, SessionExpiredPage } from './routes.js';

export function App() {
  return <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/accounts" element={<AccountsPage />} />
    <Route path="/session-expired" element={<SessionExpiredPage />} />
    <Route path="/access-denied" element={<AccessDeniedPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
