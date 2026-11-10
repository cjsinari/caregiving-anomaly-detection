import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/*
 * The gate in front of every dashboard route.
 *
 * It answers one question — is there an administrator signed in right now — and
 * sends everyone else to the login screen, remembering where they were trying
 * to go so the sign-in can return them there.
 *
 * It is not where authorization is enforced. The access check that matters
 * happens in the auth service, which re-reads the account's role from the
 * database on every /admin request and refuses a token whose account has since
 * been suspended. A guard in the browser cannot be trusted with that: the code
 * deciding it is code the client already controls, and bypassing it reveals an
 * empty shell whose every request comes back 403.
 *
 * What this *is* for is not showing an administrator a screenful of failed
 * panels. The role is checked once at sign-in, so by the time a route renders,
 * `admin` is either an administrator or null.
 */
export default function ProtectedRoute() {
  const { isAuthenticated, admin } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // Defence in depth against a future change that sets `admin` without going
  // through the sign-in flow. Cheap, and it fails in the right direction.
  if (admin.role !== 'administrator') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
