import { Navigate, Route, Routes } from 'react-router-dom';
import { AccessDeniedPage, AccountsPage, LoginPage, NotFoundPage, RegisterPage, SessionExpiredPage } from './routes.js';
import { BeneficiariesPage, NewBeneficiaryPage } from './beneficiaries.js';
import { NewTransferPage, TransferStatusPage } from './transfers.js';

export function App() {
  return <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/accounts" element={<AccountsPage />} />
    <Route path="/beneficiaries" element={<BeneficiariesPage />} />
    <Route path="/beneficiaries/new" element={<NewBeneficiaryPage />} />
    <Route path="/transfers/new" element={<NewTransferPage />} />
    <Route path="/transfers/:transferId/status" element={<TransferStatusPage />} />
    <Route path="/transfers/:transferId/receipt" element={<TransferStatusPage />} />
    <Route path="/session-expired" element={<SessionExpiredPage />} />
    <Route path="/access-denied" element={<AccessDeniedPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
