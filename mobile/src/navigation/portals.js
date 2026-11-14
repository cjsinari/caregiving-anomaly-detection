/*
 * The two portals, as the sidebar and the tab bar see them.
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
 *
 * ── Tabs (#46) ──
 *
 * Each portal is a stack whose first screen is a bottom-tab navigator
 * (`tabsRoute`). `tabs` names the screens that live in it, in bar order, and
 * `tabLabel` is the short word under each icon. Everything else -- a care
 * record, a visit report, the profile -- is pushed on the stack over the tabs.
 * routes.js reads this to know whether a destination is a tab (and so has to
 * be reached through `tabsRoute`) or a stack screen.
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
      tabLabel: 'Report',
    },
    {
      key: 'Account',
      label: 'Account',
      icon: 'person-circle-outline',
      iconActive: 'person-circle',
      route: 'Account',
      hint: 'Your profile, notifications and sign out',
      alsoActiveOn: ['Profile', 'ChangePhone'],
    },
  ],
  tabsRoute: 'CaregiverTabs',
  tabs: ['CaregiverHome', 'Assignments', 'NewReport', 'Account'],
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
      tabLabel: 'Updates',
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
    {
      key: 'Account',
      label: 'Account',
      icon: 'person-circle-outline',
      iconActive: 'person-circle',
      route: 'Account',
      hint: 'Your profile, notifications and sign out',
      alsoActiveOn: ['Profile', 'ChangePhone'],
    },
  ],
  tabsRoute: 'FamilyTabs',
  /*
   * Five tabs, which is the most a bar holds before the labels stop fitting a
   * 360dp phone. Notifications is the one left out: it is reached from the
   * bell on the home screen, which carries the unread count, and from the
   * sidebar -- a sixth tab would mean a bar too cramped to read.
   */
  tabs: ['FamilyHome', 'CareUpdates', 'CarePlan', 'Schedule', 'Account'],
};
