import { NavLink } from 'react-router-dom';
import { NAV } from './nav';
import { CloseIcon } from './icons';
import { useFilters } from '../dashboard/FilterContext';

/*
 * The main navigation.
 *
 * One <nav> rendered once, shown as a fixed column on a wide screen and as a
 * slide-over panel on a narrow one. Rendering it twice — a desktop copy and a
 * mobile copy — would put every nav item in the accessibility tree twice, and
 * would mean two lists to keep in step.
 */
export default function Sidebar({ open, onClose }) {
  /*
   * Navigation carries the shared filters.
   *
   * Without this, every nav item is a link to a bare path and moving between
   * views resets the period and the narrowing — so the views would agree about
   * what "the last 7 days" means only until an administrator clicked anything.
   */
  const { sharedSearch } = useFilters();

  return (
    <>
      {/* The scrim is click-to-close on touch. It is not the only way out: the
          panel has a close button and Escape works, because a scrim is
          invisible to a screen reader and unreachable by keyboard. */}
      {open && <div className="sidebar__scrim" onClick={onClose} aria-hidden="true" />}

      <nav
        id="console-nav"
        className={`sidebar${open ? ' sidebar--open' : ''}`}
        aria-label="Console sections"
      >
        <div className="sidebar__head">
          <div className="sidebar__mark" aria-hidden="true">MC</div>
          <div className="sidebar__brand">
            <span className="sidebar__name">MzaziCare</span>
            <span className="sidebar__role">Security console</span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm sidebar__close"
            onClick={onClose}
          >
            <CloseIcon />
            <span className="sr-only">Close navigation</span>
          </button>
        </div>

        <ul className="sidebar__list">
          {NAV.map(({ to, label, description, Icon, end }) => (
            <li key={to}>
              <NavLink
                to={{ pathname: to, search: sharedSearch }}
                end={end}
                onClick={onClose}
                className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                title={description}
              >
                <Icon />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="sidebar__foot small muted">
          <p>Every action taken here is recorded in the audit log against your account.</p>
        </div>
      </nav>
    </>
  );
}
