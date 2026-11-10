import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import LoginPage from './auth/LoginPage';
import DashboardLayout from './layout/DashboardLayout';
import OverviewPage from './pages/OverviewPage';
import EventsPage from './pages/EventsPage';
import AnomaliesPage from './pages/AnomaliesPage';
import MapPage from './pages/MapPage';
import UsersPage from './pages/UsersPage';
import SessionsPage from './pages/SessionsPage';
import AuditLogPage from './pages/AuditLogPage';

/*
 * The route table.
 *
 * Every signed-in route is nested inside one ProtectedRoute and one layout, so
 * a route cannot be added outside the guard by forgetting to wrap it — the
 * nesting is the enforcement, rather than each page remembering to check.
 *
 * The catch-all redirects rather than rendering a 404 page. There is nothing
 * for an administrator to do with a not-found screen in a console with seven
 * destinations, and a mistyped URL almost always means a stale link.
 */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="anomalies" element={<AnomaliesPage />} />
            <Route path="map" element={<MapPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="audit" element={<AuditLogPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
