import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import LoginPage from './auth/LoginPage';
import DashboardLayout from './layout/DashboardLayout';
import { LoadingState } from './components/States';

/*
 * The route table.
 *
 * Every signed-in route is nested inside one ProtectedRoute and one layout, so
 * a route cannot be added outside the guard by forgetting to wrap it — the
 * nesting is the enforcement, rather than each page remembering to check.
 *
 * ── Why the pages are lazy ──
 *
 * The charting and mapping libraries are most of this application's weight, and
 * the login screen needs neither. Loaded eagerly, an administrator signing in
 * over a mobile connection waits for Recharts and Leaflet before being shown a
 * phone-number field. Splitting per route means the login screen is a small
 * download and each view fetches its own dependencies when it is first opened —
 * which matters for a service whose users are in Kenya on mobile networks, not
 * on an office fibre connection.
 *
 * LoginPage and the layout stay eager: they are the first thing rendered, so
 * deferring them would only add a round trip.
 *
 * The catch-all redirects rather than rendering a 404 page. There is nothing
 * for an administrator to do with a not-found screen in a console with seven
 * destinations, and a mistyped URL almost always means a stale link.
 */

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const EventsPage = lazy(() => import('./pages/EventsPage'));
const AnomaliesPage = lazy(() => import('./pages/AnomaliesPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SessionsPage = lazy(() => import('./pages/SessionsPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route index element={<Lazy><OverviewPage /></Lazy>} />
            <Route path="events" element={<Lazy><EventsPage /></Lazy>} />
            <Route path="anomalies" element={<Lazy><AnomaliesPage /></Lazy>} />
            <Route path="map" element={<Lazy><MapPage /></Lazy>} />
            <Route path="users" element={<Lazy><UsersPage /></Lazy>} />
            <Route path="sessions" element={<Lazy><SessionsPage /></Lazy>} />
            <Route path="audit" element={<Lazy><AuditLogPage /></Lazy>} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

/*
 * The boundary a lazily-loaded view suspends against.
 *
 * Inside the layout, so the sidebar and the top bar stay put while a view's
 * chunk arrives: a spinner that replaces the whole console on every navigation
 * reads as a page reload rather than as a panel loading.
 */
const Lazy = ({ children }) => (
  <Suspense fallback={<LoadingState label="Loading this view…" />}>{children}</Suspense>
);
