/*
 * The navigation icons, drawn inline.
 *
 * Inline SVG rather than an icon package: there are nine of them, they never
 * change, and a dependency would add a download to every page load for shapes
 * that fit in this file. They inherit `currentColor`, so the active and
 * inactive nav states need no icon-specific styling.
 *
 * All are aria-hidden. Each one sits beside its own text label, so announcing
 * the icon as well would read every nav item twice.
 */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const OverviewIcon = () => (
  <svg {...base}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);

export const EventsIcon = () => (
  <svg {...base}><path d="M3 12h4l2.5-7 4 14 2.5-7h5" /></svg>
);

export const AnomalyIcon = () => (
  <svg {...base}><path d="M12 3.5 21 19H3z" /><path d="M12 10v4" /><path d="M12 16.75v.5" /></svg>
);

export const UsersIcon = () => (
  <svg {...base}><circle cx="9" cy="8" r="3.25" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.3a3.25 3.25 0 0 1 0 5.4" /><path d="M17.5 14.2A5.5 5.5 0 0 1 20.5 19" /></svg>
);

export const SessionsIcon = () => (
  <svg {...base}><rect x="2.5" y="4" width="19" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></svg>
);

export const AuditIcon = () => (
  <svg {...base}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>
);

export const MapIcon = () => (
  <svg {...base}><circle cx="12" cy="10" r="3" /><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /></svg>
);

export const LogoutIcon = () => (
  <svg {...base}><path d="M15 17l5-5-5-5" /><path d="M20 12H9" /><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" /></svg>
);

export const BellIcon = () => (
  <svg {...base}><path d="M18 9a6 6 0 1 0-12 0c0 4.5-2 6-2 6h16s-2-1.5-2-6" /><path d="M10.5 19a1.8 1.8 0 0 0 3 0" /></svg>
);

export const MenuIcon = () => (
  <svg {...base}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></svg>
);

export const CloseIcon = () => (
  <svg {...base}><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
);

export const SunIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" /></svg>
);

export const MoonIcon = () => (
  <svg {...base}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>
);
