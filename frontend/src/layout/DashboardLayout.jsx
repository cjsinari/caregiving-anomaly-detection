import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { navFor } from './nav';
import { FilterProvider } from '../dashboard/FilterContext';
import { LiveProvider } from '../dashboard/LiveContext';
import Toasts from '../dashboard/Toasts';
import './layout.css';

/*
 * The one layout every signed-in route renders inside.
 *
 * The heading comes from the navigation table rather than from each page, so a
 * page cannot disagree with the menu item that leads to it, and the document
 * title follows the same source — which matters for an administrator with the
 * console open in several tabs while working an incident.
 *
 * Both providers sit here rather than per page, which is what makes the shared
 * state actually shared: the filters survive navigation between views (so
 * following a drill-down keeps the period and narrowing an administrator had
 * chosen), and the live stream is one connection for the whole console rather
 * than one per screen. Mounting them inside a page would reset both on every
 * navigation and defeat the point of having them.
 */
export default function DashboardLayout() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const entry = navFor(location.pathname);

  // Close the slide-over on navigation. Without this, following a link on a
  // phone leaves the panel covering the page that was just opened.
  useEffect(() => setNavOpen(false), [location.pathname]);

  useEffect(() => {
    document.title = entry ? `${entry.title} · MzaziCare Security` : 'MzaziCare Security';
  }, [entry]);

  // Escape closes the slide-over. A scrim is unreachable by keyboard, so
  // without this the panel can be opened by keyboard and not closed by it.
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <LiveProvider>
      <FilterProvider>
        <div className="shell">
          <a className="skip-link" href="#main">Skip to content</a>

          <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

          <div className="shell__body">
            <TopBar
              title={entry?.title || 'Security console'}
              description={entry?.description}
              onOpenNav={() => setNavOpen(true)}
            />

            {/* tabIndex -1 so the skip link can move focus here, which it
                cannot do to an element that is not focusable. */}
            <main id="main" className="shell__main" tabIndex={-1}>
              <div className="shell__content">
                <Outlet />
              </div>
            </main>
          </div>

          <Toasts />
        </div>
      </FilterProvider>
    </LiveProvider>
  );
}
