import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { stats } from '../api/endpoints';
import { useTheme } from './theme';
import { BellIcon, LogoutIcon, MenuIcon, MoonIcon, SunIcon } from './icons';

/*
 * The bar across the top: where you are, what needs attention, and who you are.
 *
 * The alert count is high-and-critical events in the last 24 hours. It is a
 * count of recorded events rather than of things an administrator has not
 * looked at, and the tooltip says so — a badge that claimed to track "unread"
 * while actually tracking "recent" would quietly mislead the person relying on
 * it to know whether anything new had happened.
 */
export default function TopBar({ title, description, onOpenNav }) {
  const { admin, logout } = useAuth();
  const { mode, cycle } = useTheme();
  const alerts = useAlertCount();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    // No finally: on success this component unmounts, and leaving the button
    // disabled is the correct state for the frame before that happens.
    try { await logout(); } catch { setSigningOut(false); }
  };

  const themeLabel = mode === 'system' ? 'Match system theme'
    : mode === 'light' ? 'Light theme' : 'Dark theme';

  return (
    <header className="topbar">
      <button type="button" className="btn btn--ghost topbar__menu" onClick={onOpenNav} aria-controls="console-nav">
        <MenuIcon />
        <span className="sr-only">Open navigation</span>
      </button>

      <div className="topbar__heading">
        <h1 className="topbar__title">{title}</h1>
        {description && <p className="topbar__description">{description}</p>}
      </div>

      <div className="topbar__actions">
        <Link
          to="/events?severity=critical"
          className="topbar__alerts"
          title={`${alerts} high or critical event${alerts === 1 ? '' : 's'} recorded in the last 24 hours`}
        >
          <BellIcon />
          {alerts > 0 && (
            <span className="topbar__count">{alerts > 99 ? '99+' : alerts}</span>
          )}
          <span className="sr-only">
            {alerts > 0
              ? `${alerts} high or critical events in the last 24 hours. View them.`
              : 'No high or critical events in the last 24 hours.'}
          </span>
        </Link>

        <button type="button" className="btn btn--ghost topbar__icon-btn" onClick={cycle} title={themeLabel}>
          {mode === 'dark' ? <MoonIcon /> : <SunIcon />}
          <span className="sr-only">{themeLabel}. Change theme.</span>
        </button>

        <div className="topbar__who">
          <span className="topbar__name">{admin?.fullName || 'Administrator'}</span>
          <span className="topbar__meta">Administrator</span>
        </div>

        <button type="button" className="btn btn--outline btn--sm" onClick={onSignOut} disabled={signingOut}>
          <LogoutIcon />
          <span className="topbar__signout-label">{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </header>
  );
}

/*
 * How many high-or-critical events the last 24 hours hold.
 *
 * Polled on a slow timer. The service applies a per-session request budget that
 * the data panels have the real claim on, and a badge in the chrome is not
 * worth spending it on; once a minute is as current as this number needs to be.
 *
 * A failure is swallowed deliberately. An unreachable service already announces
 * itself on every panel, and a second complaint in the chrome adds noise rather
 * than information. The badge simply holds its last value.
 */
function useAlertCount() {
  const [count, setCount] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer;

    const poll = async () => {
      try {
        const summary = await stats.summary({ window: '24h' });
        if (!cancelled.current) setCount(summary.metrics?.urgentEvents?.value ?? 0);
      } catch { /* the panels report service trouble; the chrome stays quiet */ }
      if (!cancelled.current) timer = setTimeout(poll, 60_000);
    };

    poll();
    return () => { cancelled.current = true; clearTimeout(timer); };
  }, []);

  return count;
}
