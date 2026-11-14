import { useEffect, useRef } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Touchable from '../oneui/Touchable';
import { usePortalChrome } from './PortalChrome';
import { goTo } from '../../navigation/routes';
import { useAuth } from '../../auth/AuthContext';
import { colors, oneui, sidebarColors, space, type, TOUCH_TARGET } from '../../theme/tokens';
import { initials } from '../../utils/datetime';

/*
 * CAREGIVER PORTAL: the navy sidebar, collapsible, from the approved mockups.
 *
 * ── What "collapsible" has to mean on a phone ──
 *
 * Two different things, and the component does both (see PortalChrome for the
 * width rule). On a tablet it collapses to a 68dp icon rail that is still a
 * usable navigation; on a phone it collapses to nothing and is summoned over
 * the content. The important part is that collapsing never removes the
 * navigation -- on the rail every destination is still one tap away, it just
 * has no label -- because a "collapsed" state that hides the way out of a
 * screen is a dead end wearing an animation.
 *
 * ── Three things the rail has to get right ──
 *
 *   The labels do not simply fade. They are unmounted from the accessibility
 *   tree with them, because a screen reader happily reads text at opacity 0
 *   and would announce every label on a rail that visibly has none.
 *
 *   The icons stay 48dp. A 68dp rail has the room; what it does not have is an
 *   excuse to shrink the targets to fit a label that is no longer there.
 *
 *   The active item is not only teal. It carries a filled icon against the
 *   outline used by the rest, so which page you are on survives both the rail
 *   and a colour vision deficiency.
 *
 * ── Why the animation is on width ──
 *
 * Width cannot run on the native driver, which is normally a reason to avoid
 * animating it. The alternative here -- a fixed-width panel sliding on
 * translateX -- cannot produce the icon rail, because a panel slid left shows
 * its right-hand edge, not its icons. So: one 240ms layout animation per
 * deliberate tap, which is a cost this earns.
 */

/*
 * The destinations, heading and role label come from the portal definition
 * the navigator handed to PortalChrome (navigation/portals.js), so the same
 * sidebar frames both the caregiver and the family portal and neither can
 * offer a route that only exists in the other.
 */

export default function Sidebar({ navigation, active }) {
  const { portal, expanded, close, toggle, wide, isOverlay } = usePortalChrome();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const collapsedWidth = wide ? oneui.sidebar.rail : 0;
  const targetWidth = expanded ? oneui.sidebar.full : collapsedWidth;

  const width = useRef(new Animated.Value(targetWidth)).current;
  // Labels are driven separately so they finish fading before the panel has
  // finished narrowing -- text that is still legible at 80dp of width looks
  // clipped rather than hidden.
  const labelOpacity = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  /*
   * Animate only when something actually changed.
   *
   * Both values are initialised to where they already belong, so the first
   * pass of this effect would otherwise run a 240ms animation from a value to
   * itself on every mount -- invisible, but it schedules frames on every
   * screen change and makes every test that renders a caregiver screen warn
   * about state updates outside act().
   */
  const settledAt = useRef(targetWidth);

  useEffect(() => {
    if (settledAt.current === targetWidth) return;
    settledAt.current = targetWidth;

    Animated.parallel([
      Animated.timing(width, {
        toValue: targetWidth,
        duration: oneui.motion.base,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(labelOpacity, {
        toValue: expanded ? 1 : 0,
        duration: expanded ? oneui.motion.base : oneui.motion.fast,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [targetWidth, expanded, width, labelOpacity]);

  /*
   * Android's back button shuts an open overlay before it leaves the screen.
   *
   * Without this, the back gesture on a phone with the sidebar open navigates
   * away underneath it, which leaves the sidebar sitting over a screen nobody
   * asked for.
   */
  useEffect(() => {
    if (!isOverlay || !expanded) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [isOverlay, expanded, close]);

  const go = (item) => {
    // Closing first on a phone: the new screen should not be revealed by a
    // sidebar sliding off it a moment later.
    if (isOverlay) close();
    // Through goTo, because the sidebar is drawn on stack screens too, and a
    // tab cannot be reached from one by its bare name (navigation/routes.js).
    if (item.key !== active) goTo(navigation, portal, item.route);
  };

  const showLabels = expanded;

  const panel = (
    <Animated.View
      style={[
        styles.panel,
        {
          width,
          paddingTop: insets.top + space.lg,
          paddingBottom: Math.max(insets.bottom, space.md),
        },
        isOverlay && styles.panelFloating,
      ]}
      accessibilityViewIsModal={isOverlay && expanded}
    >
      {/* ── heading ── */}
      <View style={styles.head}>
        {showLabels ? (
          <Animated.Text
            style={[styles.brand, { opacity: labelOpacity }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {portal.heading}
          </Animated.Text>
        ) : (
          <View style={styles.brandMark} importantForAccessibility="no">
            <Ionicons name="shield-checkmark" size={18} color={colors.onTeal} />
          </View>
        )}

        {/*
         * The collapse control lives in the sidebar as well as in the top bar.
         * On a tablet the top bar is a long way from the sidebar, and reaching
         * across the screen to shut the thing you are looking at is the kind
         * of small wrongness nobody reports and everybody feels.
         */}
        {wide && showLabels ? (
          <Pressable
            onPress={toggle}
            hitSlop={10}
            style={styles.collapse}
            accessibilityRole="button"
            accessibilityLabel="Collapse the sidebar"
          >
            <Ionicons name="chevron-back" size={18} color={sidebarColors.inkMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* ── destinations ── */}
      <View style={styles.items}>
        {portal.items.map((item) => {
          const isActive = item.key === active
            || (item.alsoActiveOn || []).includes(active);

          return (
            <Touchable
              key={item.key}
              onPress={() => go(item)}
              scale={false}
              style={[
                styles.item,
                !showLabels && styles.itemRail,
                isActive && styles.itemActive,
              ]}
              rippleColor="rgba(255,255,255,0.14)"
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityHint={isActive ? undefined : item.hint}
              accessibilityState={{ selected: isActive }}
            >
              <Ionicons
                name={isActive ? item.iconActive : item.icon}
                size={20}
                color={isActive ? colors.onTeal : sidebarColors.inkMuted}
              />
              {/* Unmounted, not faded: see the note at the top. */}
              {showLabels ? (
                <Animated.Text
                  style={[
                    styles.itemLabel,
                    isActive && styles.itemLabelActive,
                    { opacity: labelOpacity },
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Animated.Text>
              ) : null}
            </Touchable>
          );
        })}
      </View>

      <View style={styles.spacer} />

      {/* ── who is signed in ── */}
      <View style={styles.footer}>
        <View style={styles.divider} />
        <View style={[styles.account, !showLabels && styles.accountRail]}>
          <View style={styles.avatar} importantForAccessibility="no">
            <Text style={styles.avatarText}>{initials(user?.fullName)}</Text>
          </View>
          {showLabels ? (
            <Animated.View style={[styles.accountText, { opacity: labelOpacity }]}>
              <Text style={styles.accountName} numberOfLines={1}>
                {user?.fullName || 'Signed in'}
              </Text>
              <Text style={styles.accountRole}>{portal.roleLabel}</Text>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );

  /*
   * On a phone the panel floats, so it needs a scrim: without one the content
   * behind stays tappable, and a half-covered list that still responds to
   * taps is how someone checks in to the wrong visit.
   */
  if (isOverlay) {
    if (!expanded) return null;
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          style={[StyleSheet.absoluteFill, styles.scrim]}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close the navigation sidebar"
        />
        {panel}
      </View>
    );
  }

  return panel;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: sidebarColors.surface,
    overflow: 'hidden',
    paddingHorizontal: space.md,
  },
  panelFloating: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    // One UI rounds a floating surface on the side that is not against an
    // edge; the left edge is against the screen, so only the right is round.
    borderTopRightRadius: oneui.radius.sheet,
    borderBottomRightRadius: oneui.radius.sheet,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 6, height: 0 },
    elevation: 16,
  },
  scrim: { backgroundColor: 'rgba(8, 22, 38, 0.55)' },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    paddingHorizontal: space.sm,
    marginBottom: space.xl,
  },
  brand: {
    ...type.label,
    color: sidebarColors.heading,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  collapse: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  items: { gap: space.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: space.md,
    borderRadius: oneui.radius.control,
    overflow: 'hidden',
  },
  // On the rail the row is a centred square, so the icon does not sit
  // off-centre where a label used to be.
  itemRail: { justifyContent: 'center', paddingHorizontal: 0 },
  itemActive: { backgroundColor: sidebarColors.active },
  itemLabel: { ...type.bodyMedium, fontSize: 14, color: sidebarColors.inkMuted, flexShrink: 1 },
  itemLabelActive: { fontFamily: type.button.fontFamily, color: colors.onTeal },

  spacer: { flex: 1, minHeight: space.xl },

  footer: { gap: space.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: sidebarColors.divider },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  accountRail: { justifyContent: 'center', paddingHorizontal: 0 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: type.button.fontFamily, fontSize: 12, color: colors.onTeal },
  accountText: { flex: 1 },
  accountName: { ...type.captionMedium, color: sidebarColors.ink },
  accountRole: { ...type.caption, fontSize: 11, color: sidebarColors.inkMuted },
});
