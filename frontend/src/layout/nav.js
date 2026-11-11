import {
  AnomalyIcon, AuditIcon, EventsIcon, MapIcon, OverviewIcon, SessionsIcon, UsersIcon,
} from './icons';

/*
 * The navigation, as data.
 *
 * One list drives the sidebar, the page titles and the document title, so a
 * route cannot be added to the menu without a name and a description, and the
 * heading on a page cannot drift from the label that leads to it.
 *
 * The descriptions are written for someone who has not been told what the
 * dashboard does. "Anomalies" means nothing on its own; "sign-ins the model
 * scored as unusual" does.
 */
export const NAV = [
  {
    to: '/',
    label: 'Overview',
    title: 'Security overview',
    description: 'What has happened across the service, and what needs attention now.',
    Icon: OverviewIcon,
    end: true,
  },
  {
    to: '/events',
    label: 'Security events',
    title: 'Security events',
    description: 'Every recorded event, newest first — sign-ins, refusals, detections and actions.',
    Icon: EventsIcon,
  },
  {
    to: '/anomalies',
    label: 'Anomalies',
    title: 'Anomaly review',
    description: 'Sign-ins the risk model scored as unusual, and what the service did about each one.',
    Icon: AnomalyIcon,
  },
  {
    to: '/map',
    label: 'Locations',
    title: 'Sign-in locations',
    description: 'Where sign-ins came from, with impossible-travel pairs drawn between them.',
    Icon: MapIcon,
  },
  {
    to: '/users',
    label: 'Users',
    title: 'Accounts',
    description: 'The accounts on the service, their standing, and their security history.',
    Icon: UsersIcon,
  },
  {
    to: '/sessions',
    label: 'Sessions',
    title: 'Sessions',
    description: 'Who is signed in right now, from which device and address.',
    Icon: SessionsIcon,
  },
  {
    to: '/audit',
    label: 'Audit log',
    title: 'Audit log',
    description: 'The append-only record of every administrator action and automated decision.',
    Icon: AuditIcon,
  },
];

/** The nav entry for a path, used for the page heading and the document title. */
export function navFor(pathname) {
  if (pathname === '/') return NAV[0];
  return NAV.find((item) => item.to !== '/' && pathname.startsWith(item.to)) || null;
}
