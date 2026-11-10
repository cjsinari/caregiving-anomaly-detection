import { useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useIdleTimeout } from './useIdleTimeout';

/*
 * Signs the console out after a period of no activity, with a warning first.
 *
 * Mounted inside the layout, so it is only ever running while an administrator
 * is actually signed in — there is nothing to time out on the login screen, and
 * a timer running there would be a timer running for nobody.
 */
const TIMEOUT_MINUTES = Number(import.meta.env?.VITE_IDLE_TIMEOUT_MINUTES) || 15;

export default function IdleGuard() {
  const { isAuthenticated, endSession } = useAuth();

  const onTimeout = useCallback(() => {
    // Told, not merely signed out. Someone returning to a login screen with no
    // explanation assumes the console is broken, and the next thing they do is
    // find a way to stop it happening.
    endSession({
      tellService: true,
      message: `You were signed out after ${TIMEOUT_MINUTES} minutes without activity.`,
    });
  }, [endSession]);

  const { msRemaining, stayActive } = useIdleTimeout({
    enabled: isAuthenticated,
    timeoutMinutes: TIMEOUT_MINUTES,
    onTimeout,
  });

  if (msRemaining === null) return null;

  const seconds = Math.max(Math.ceil(msRemaining / 1000), 0);

  return (
    <div className="idle" role="alertdialog" aria-labelledby="idle-title" aria-describedby="idle-body">
      <div className="idle__panel">
        <h2 className="idle__title" id="idle-title">Still there?</h2>
        <p className="idle__body" id="idle-body">
          This console holds the security history of the whole service, so it signs itself out when
          it is left unattended. You will be signed out in{' '}
          <strong className="tabular">{seconds}</strong> second{seconds === 1 ? '' : 's'}.
        </p>
        <div className="idle__actions">
          <button type="button" className="btn btn--primary" onClick={stayActive} autoFocus>
            Keep me signed in
          </button>
          <button type="button" className="btn btn--ghost" onClick={onTimeout}>
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
