/*
 * The two portals, as the sidebar sees them.
 *
 * One sidebar component serves both (src/components/caregiver/Sidebar.jsx);
 * what differs is its heading, the role named under the account, and the
 * destinations. Those live here rather than inside the sidebar, so adding a
 * screen to one portal is an edit to a list, and so it is impossible for one
 * portal's sidebar to offer a route that only exists in the other -- each
 * navigator hands its own definition to the chrome around it.
 *
 * `route` is the screen a tap navigates to. `alsoActiveOn` lights the item up
 * on screens reached *through* it, so a visit report opened from the chooser
 * still shows Visit Report as the current section.
 */

export const CAREGIVER_PORTAL = {
  heading: 'CAREGIVER PORTAL',
  roleLabel: 'Caregiver',
  items: [
    {
      key: 'Home',
      label: 'Home',
      icon: 'home-outline',
      iconActive: 'home',
      route: 'CaregiverHome',
      hint: 'Your day: visits, tasks and alerts',
    },
    {
      key: 'Assignments',
      label: 'Assignments',
      icon: 'people-outline',
      iconActive: 'people',
      route: 'Assignments',
      hint: 'Everyone you are assigned to',
    },
    {
      key: 'VisitReport',
      label: 'Visit Report',
      icon: 'document-text-outline',
      iconActive: 'document-text',
      route: 'NewReport',
      hint: 'Start a visit report',
      alsoActiveOn: ['VisitReport'],
    },
  ],
};

export const FAMILY_PORTAL = {
  heading: 'FAMILY PORTAL',
  roleLabel: 'Family member',
  items: [
    {
      key: 'FamilyHome',
      label: 'Home',
      icon: 'home-outline',
      iconActive: 'home',
      route: 'FamilyHome',
      hint: 'How your loved one is doing',
    },
    {
      key: 'CareUpdates',
      label: 'Care Updates',
      icon: 'pulse-outline',
      iconActive: 'pulse',
      route: 'CareUpdates',
      hint: 'Every visit, note and incident',
    },
    {
      key: 'CarePlan',
      label: 'Care Plan',
      icon: 'heart-outline',
      iconActive: 'heart',
      route: 'CarePlan',
      hint: 'Profile, medications and the care team',
    },
    {
      key: 'Schedule',
      label: 'Schedule',
      icon: 'calendar-outline',
      iconActive: 'calendar',
      route: 'Schedule',
      hint: 'Upcoming visits',
    },
    {
      key: 'Notifications',
      label: 'Notifications',
      icon: 'notifications-outline',
      iconActive: 'notifications',
      route: 'Notifications',
      hint: 'Alerts about care and about your account',
    },
  ],
};
