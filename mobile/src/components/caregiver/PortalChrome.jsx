import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { oneui } from '../../theme/tokens';

/*
 * Whether the sidebar is open, held above the navigator so it survives a
 * screen change.
 *
 * ── Why this is context and not state inside the shell ──
 *
 * Every caregiver screen draws its own PortalShell, so every screen mounts its
 * own sidebar. If the open/closed flag lived in the shell, expanding the
 * sidebar, tapping Assignments and arriving at a collapsed one would be the
 * normal experience -- the sidebar would appear to shut itself every time it
 * was used. Holding it here, once, above the stack, means it is the *same*
 * sidebar as far as the person is concerned.
 *
 * ── The responsive rule, and why there is one ──
 *
 * The approved mockups are drawn wide, with a permanent sidebar beside the
 * content. On a 360dp phone there is no such thing as beside: a 248dp sidebar
 * leaves 112dp of content, and even the 68dp icon rail takes a fifth of the
 * screen away from the thing the caregiver actually came to read.
 *
 * So the rule is by width, not by platform:
 *
 *   >= 700dp   (tablet, or a phone in landscape) the sidebar is permanent.
 *              Collapsed it is an icon rail; expanded it pushes the content
 *              across, exactly as the mockups show.
 *   <  700dp   (a phone upright) the sidebar is not there until it is asked
 *              for, and then it floats over the content with a scrim and is
 *              dismissed by a tap outside, by the back gesture, or by picking
 *              something.
 *
 * Both are the same component and the same navigation. What changes is
 * whether an open sidebar steals space or borrows it.
 */

const PortalChromeContext = createContext(null);

export function usePortalChrome() {
  const value = useContext(PortalChromeContext);
  if (!value) throw new Error('usePortalChrome must be used inside a PortalChromeProvider');
  return value;
}

export function PortalChromeProvider({ children }) {
  const { width } = useWindowDimensions();
  const wide = width >= oneui.sidebar.overlayBelow;

  /*
   * Open by default on a wide screen, shut on a phone.
   *
   * A tablet has the room, and the mockups show it open. A phone does not, and
   * an app that opens onto its own navigation menu rather than onto the
   * caregiver's day has got its priorities backwards.
   */
  const [expanded, setExpanded] = useState(wide);

  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const close = useCallback(() => setExpanded(false), []);

  const value = useMemo(() => ({
    expanded,
    setExpanded,
    toggle,
    close,
    wide,
    /** True when an open sidebar covers the content instead of pushing it. */
    isOverlay: !wide,
    /** How much horizontal room the sidebar takes from the content right now. */
    reservedWidth: wide ? (expanded ? oneui.sidebar.full : oneui.sidebar.rail) : 0,
  }), [expanded, toggle, close, wide]);

  return (
    <PortalChromeContext.Provider value={value}>
      {children}
    </PortalChromeContext.Provider>
  );
}
