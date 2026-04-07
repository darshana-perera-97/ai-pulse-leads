import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import Login from './pages/Login';
import DashboardLayout from './pages/DashboardLayout';
import Analytics from './pages/Analytics';
import SearchLeads from './pages/SearchLeads';
import Leads from './pages/Leads';
import Messages from './pages/Messages';
import Campaigns from './pages/Campaigns';
import Integration from './pages/Integration';
import Settings from './pages/Settings';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="analytics" replace />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="search-leads" element={<SearchLeads />} />
          <Route path="leads" element={<Leads />} />
          <Route path="messages" element={<Messages />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="integration" element={<Integration />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
