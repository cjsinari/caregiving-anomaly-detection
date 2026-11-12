import { useAuth } from '../auth/AuthContext';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';

/*
 * Which half of the app exists.
 *
 * -- Why this is a swap and not a redirect --
 *
 * The alternative is one stack holding every screen, with a `navigate('Login')`
 * when the session ends. That version is wrong in a way that is easy to miss
 * and hard to fix later: the protected screens stay on the stack behind the
 * login screen, so the back gesture walks straight into them. They still hold
 * whatever they last rendered -- a care plan, a phone number, a visit note --
 * and that is readable by whoever is holding the phone, with no session at all.
 *
 * Swapping navigators means the signed-out app does not contain those screens.
 * There is no history to go back into, because they were never mounted. That is
 * the issue's "blocks back-navigation into protected screens", enforced by
 * construction rather than by a guard somebody has to remember to add to every
 * new screen.
 *
 * `restoring` renders nothing: App.jsx is still holding the splash screen, and
 * mounting the auth stack for the one frame before a restored session resolves
 * is how an app flashes a login form at someone who is already signed in.
 */
export default function RootNavigator() {
  const { status } = useAuth();

  if (status === 'restoring') return null;
  return status === 'signedIn' ? <AppNavigator /> : <AuthNavigator />;
}
