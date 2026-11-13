/*
 * Design tokens for the LindaCare mobile app.
 *
 * Read off the approved mockups and named here so no screen below this file
 * carries a raw hex value. The web console has the same arrangement in
 * frontend/src/styles/tokens.css; the two are deliberately *not* the same
 * palette. The console is a dense, neutral surface an administrator stares at
 * for an hour; this is a handful of screens a caregiver opens in daylight,
 * between houses, on a mid-range Android phone. Navy and teal are what the
 * mockups specify, and they carry the brand on a small screen better than the
 * console's blue-on-bone does.
 *
 * ── Contrast ──
 *
 * Measured, not estimated. Every text pairing the screens actually use, against
 * WCAG 2.1 AA (4.5:1 body text, 3:1 large text and UI boundaries):
 *
 *   ink on surface              #14283d on #ffffff   14.99:1  AAA
 *   label on surface            #46678a on #ffffff    5.89:1  AA
 *   inkMuted on surface         #55708c on #ffffff    5.14:1  AA
 *   white on navy               #ffffff on #15314f   13.26:1  AAA
 *   navy subtitle on navy       #7cb0e8 on #15314f    5.83:1  AA
 *   white on teal (button)      #ffffff on #17807d    4.75:1  AA
 *   link on surface             #1c5c96 on #ffffff    6.95:1  AA
 *   success on mint banner      #15674e on #e4f4ec    5.99:1  AA
 *   warning on amber banner     #8a5a10 on #fdf2e2    5.34:1  AA
 *   danger on surface           #c0392b on #ffffff    5.44:1  AA
 *   info on blue banner         #2a5f93 on #e8f1fa    5.83:1  AA
 *   teal focus ring on field    #17807d on #f4f8fb    4.45:1  AA (1.4.11)
 *
 * ── The three that do not reach a threshold, and why each is allowed to ──
 *
 * Placeholder text, #93a7bb on #f4f8fb, is 2.32:1. It is exempt only because
 * it never carries information: every field in this app has a permanently
 * visible label above it, and the placeholder repeats a format hint at most.
 * A placeholder standing in for a label would not be exempt, which is the
 * reason none of them do.
 *
 * The resting field border, #e2eaf1 on #ffffff, is 1.22:1 — well under the
 * 3:1 that WCAG 1.4.11 asks of a component boundary. This is a knowing
 * deviation from the standard in favour of the approved mockups, and it is
 * survivable rather than correct: the input is still identifiable from its
 * persistent label and its filled background, and the moment it takes focus
 * the border becomes teal at 4.45:1. It is logged for the accessibility pass
 * in issue #47, where the call is either to darken this token to roughly
 * #b6c6d4 or to accept it explicitly.
 *
 * Disabled button ink, #8fa0b1 on #e3e9ef, is 2.19:1 and is exempt under
 * 1.4.3, which excludes inactive controls. The submit button spends real time
 * disabled on these forms, so it never communicates by colour alone: the
 * reason it cannot be pressed is always also stated in text beneath it.
 */

export const colors = {
  // ── Brand ──
  navy: '#15314f',          // hero header, splash
  navyDeep: '#102640',      // the lower half of the header gradient
  navyRaised: '#1d4169',    // cards sitting on navy (the frozen screen)
  teal: '#17807d',          // primary action, logo tile
  tealPressed: '#126663',
  tealSoft: '#e4f4ec',

  // ── Surfaces ──
  page: '#eaf1f6',          // behind the white cards
  surface: '#ffffff',
  field: '#f4f8fb',
  fieldBorder: '#e2eaf1',
  fieldBorderFocus: '#17807d',

  // ── Ink ──
  ink: '#14283d',
  inkMuted: '#55708c',
  label: '#46678a',         // the uppercase field labels
  placeholder: '#93a7bb',
  onNavy: '#ffffff',
  onNavyMuted: '#7cb0e8',
  onTeal: '#ffffff',
  link: '#1c5c96',

  // ── Status ──
  success: '#15674e',
  successBg: '#e4f4ec',
  warning: '#8a5a10',
  warningBg: '#fdf2e2',
  danger: '#c0392b',
  dangerBg: '#fdecea',
  info: '#2a5f93',
  infoBg: '#e8f1fa',

  // ── Disabled ──
  disabledBg: '#e3e9ef',
  disabledInk: '#8fa0b1',
};

export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 44,
};

export const radius = {
  sm: 8, md: 10, lg: 16, sheet: 24, pill: 999,
};

/*
 * Type.
 *
 * Poppins for headings, because that is what the mockups are set in and its
 * geometric shapes are what make the hero read as a brand rather than as a
 * system dialog. Body text stays on Poppins too for consistency at these
 * sizes. `fonts.load` in src/theme/fonts.js is what actually registers them;
 * every style here names a family that file guarantees exists.
 */
export const font = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
};

export const type = {
  hero: { fontFamily: font.bold, fontSize: 28, lineHeight: 36 },
  title: { fontFamily: font.semibold, fontSize: 20, lineHeight: 28 },
  subtitle: { fontFamily: font.regular, fontSize: 14, lineHeight: 21 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 22 },
  button: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
  // Uppercase, tracked out, small: the mockups' field labels. Tracking is what
  // keeps uppercase legible at this size.
  label: { fontFamily: font.semibold, fontSize: 11, lineHeight: 16, letterSpacing: 0.8 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  captionMedium: { fontFamily: font.medium, fontSize: 13, lineHeight: 19 },
};

/*
 * The minimum touch target, in density-independent pixels.
 *
 * 48 is the Android accessibility floor and the number the QA pass in issue #47
 * will measure against. Anything tappable in this app either is at least this
 * tall or carries a hitSlop that makes it so.
 */
export const TOUCH_TARGET = 48;

export const shadow = {
  card: {
    shadowColor: '#0b2033',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

/*
 * ─────────────────────────── One UI 9 ───────────────────────────
 *
 * The caregiver screens (#44) are drawn in Samsung's One UI 9 idiom, which is
 * the design language of the phones this app is actually installed on in
 * Nairobi. Everything below is additive: the auth screens above predate it and
 * are untouched, so nothing in #41–#43 shifts underfoot.
 *
 * What One UI actually asks for, and what each of these tokens is doing about
 * it:
 *
 *   Reach.  One UI's defining move is pushing content down the screen so the
 *           things you touch sit under your thumb and the things you only read
 *           sit above it. That is `oneui.headroom` -- the empty band a large
 *           title opens with -- and it is why the primary action on these
 *           screens is pinned to the bottom rather than following the content.
 *
 *   The collapsing title.  A large title that shrinks into the bar as the list
 *           scrolls. `oneui.titleLarge` is the resting size, `type.title` is
 *           what it lands on, and `oneui.collapse` is the scroll distance over
 *           which it happens.
 *
 *   Roundness.  One UI 9 rounds harder than anything else on Android: 26dp on
 *           a card, fully round on anything pressable. A 10dp radius inside a
 *           26dp card reads as a mistake, hence `inner` -- nested corners are
 *           concentric, not identical.
 *
 *   Grouping.  Rows live in one rounded container with hairlines between them,
 *           rather than as separate floating cards. `hairline` is that divider.
 *
 *   Restraint in motion.  Short, soft, never bouncy. A press is a scale, not a
 *           colour flash.
 */
export const oneui = {
  radius: {
    card: 26,      // the grouped container
    inner: 18,     // a control sitting inside one
    control: 14,   // a field or small tile
    pill: 999,
    sheet: 32,
  },

  /** The band of air a large-title screen opens with. */
  headroom: 12,

  /** Scroll distance, in dp, over which the large title becomes the bar title. */
  collapse: 56,

  /** The height of the compact bar the title collapses into. */
  barHeight: 52,

  motion: { fast: 160, base: 240, slow: 340 },

  /** A press is a scale. 0.97 is felt rather than seen, which is the point. */
  pressScale: 0.97,

  sidebar: {
    /** Icons only. Still a legal touch target at this width. */
    rail: 68,
    /** Icons and labels. */
    full: 248,
    /** Below this screen width the expanded sidebar covers the content
     *  instead of pushing it, because pushing it leaves nothing readable. */
    overlayBelow: 700,
  },
};

/*
 * The sidebar's own palette.
 *
 * Darker than the hero navy on purpose: the sidebar is a permanent chrome
 * surface sitting beside content, and at hero navy it competes with the page
 * instead of framing it.
 *
 *   sidebarInk on sidebar        #e8f0f8 on #0d2440   13.95:1  AAA
 *   sidebarInkMuted on sidebar   #8fb0d4 on #0d2440    7.05:1  AA
 *   sidebarHeading on sidebar    #6f91b6 on #0d2440    4.60:1  AA (large/tracked)
 *   onTeal on teal (active row)  #ffffff on #17807d    4.75:1  AA
 */
export const sidebarColors = {
  surface: '#0d2440',
  active: colors.teal,
  activePressed: colors.tealPressed,
  hover: '#16355a',
  ink: '#e8f0f8',
  inkMuted: '#8fb0d4',
  heading: '#6f91b6',
  divider: '#1b3d64',
};
