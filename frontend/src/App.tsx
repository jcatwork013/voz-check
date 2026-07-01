import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './layout/Layout';
import { Spinner } from './components/ui';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import LogsPage from './pages/LogsPage';
import RulesPage from './pages/RulesPage';
import AiPage from './pages/AiPage';
import ForumPage from './pages/ForumPage';
import StrikesPage from './pages/StrikesPage';
import UsersPage from './pages/UsersPage';
import GuidePage from './pages/GuidePage';
import ScanPage from './pages/ScanPage';
import StatsPage from './pages/StatsPage';
import type { ReactNode } from 'react';

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user, ready } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={ready && user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/scan" element={<RequireAuth><ScanPage /></RequireAuth>} />
      <Route path="/logs" element={<RequireAuth><LogsPage /></RequireAuth>} />
      <Route path="/stats" element={<RequireAuth><StatsPage /></RequireAuth>} />
      <Route path="/rules" element={<RequireAuth><RulesPage /></RequireAuth>} />
      <Route path="/ai" element={<RequireAuth><AiPage /></RequireAuth>} />
      <Route path="/forum" element={<RequireAuth><ForumPage /></RequireAuth>} />
      {/* Tích hợp XenForo gộp vào "Kết nối Forum" — giữ redirect cho link cũ. */}
      <Route path="/integration" element={<Navigate to="/forum" replace />} />
      <Route path="/strikes" element={<RequireAuth><StrikesPage /></RequireAuth>} />
      <Route path="/users" element={<RequireAuth><UsersPage /></RequireAuth>} />
      <Route path="/guide" element={<RequireAuth><GuidePage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
