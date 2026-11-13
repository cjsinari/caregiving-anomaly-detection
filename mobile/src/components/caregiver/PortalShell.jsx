import { useRef } from 'react';
import {
  Animated, Platform, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sidebar from './Sidebar';
import { usePortalChrome } from './PortalChrome';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * The frame every caregiver screen is drawn inside: the sidebar, the compact
 * top bar, and the One UI large title that turns into the bar's title as the
 * page scrolls.
 *
 * ── The large title is the One UI idea, and it is not decoration ──
 *
 * One UI exists because phones got tall enough that the top of the screen is
 * out of reach. Its answer is to open every page with a large heading in the
 * upper third -- which is read, not touched -- and to put the controls below
 * it, in the half of the screen a thumb covers. When the content scrolls, the
 * heading shrinks into the bar and gives the room back.
 *
 * So the heading here genuinely collapses rather than fading into a sticky
 * header. Both titles are driven off the same scroll offset, crossing over
 * halfway, and both run on the native driver so the text does not lag the
 * finger on a mid-range Android.
 *
 * ── Why the shell owns the ScrollView ──
 *
 * Because the collapse needs the scroll offset, and a screen that supplies its
 * own list would have to thread an Animated.Value back up. Four screens doing
 * that by hand is four chances to drive the header off the wrong scroller.
 * Screens that cannot use it -- a form that has to manage the keyboard --
 * pass `scroll={false}` and lay out their own body; they keep the chrome and
 * lose only the collapse.
 */
export default function PortalShell({
  active,
  navigation,
  barTitle,
  title,
  eyebrow,
  subtitle,
  titleTrailing = null,
  onBack = null,
  footer = null,
  onRefresh = null,
  refreshing = false,
  scroll = true,
  children,
}) {
  const insets = useSafeAreaInsets();
  const { toggle, expanded, wide } = usePortalChrome();
  const scrollY = useRef(new Animated.Value(0)).current;

  const collapse = oneui.collapse;

  const barTitleOpacity = scrollY.interpolate({
    inputRange: [collapse * 0.45, collapse],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const largeOpacity = scrollY.interpolate({
    inputRange: [0, collapse * 0.8],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const largeShift = scrollY.interpolate({
    inputRange: [0, collapse],
    outputRange: [0, -10],
    extrapolate: 'clamp',
  });

  const header = title ? (
    <Animated.View
      style={[
        styles.largeTitleBlock,
        { opacity: largeOpacity, transform: [{ translateY: largeShift }] },
      ]}
    >
      <View style={styles.largeTitleText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        {/*
         * The large title is the screen's heading for assistive tech and the
         * bar copy is not, so a screen reader announces it once rather than
         * twice under two different names.
         */}
        <Text style={styles.largeTitle} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {titleTrailing}
    </Animated.View>
  ) : null;

  const body = scroll ? (
    <Animated.ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: (footer ? 0 : Math.max(insets.bottom, space.lg)) + space.xxxl },
      ]}
      scrollEventThrottle={16}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: scrollY } } }],
        { useNativeDriver: true }
      )}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? (
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.teal}
          colors={[colors.teal]}
          progressBackgroundColor={colors.surface}
        />
      ) : undefined}
    >
      {header}
      {children}
    </Animated.ScrollView>
  ) : (
    <View style={styles.flex}>
      {header}
      {children}
    </View>
  );

  return (
    <View style={styles.root}>
      {/* On a wide screen the sidebar is a sibling and takes real width. On a
          phone it renders nothing here and floats over everything below. */}
      {wide ? <Sidebar navigation={navigation} active={active} /> : null}

      <View style={styles.column}>
        {/* ── the compact bar ── */}
        <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + oneui.barHeight }]}>
          <Pressable
            onPress={onBack || toggle}
            style={styles.barButton}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={onBack ? 'Back' : expanded ? 'Collapse the sidebar' : 'Open the sidebar'}
            accessibilityState={onBack ? undefined : { expanded }}
          >
            <Ionicons
              name={onBack ? 'chevron-back' : 'menu'}
              size={22}
              color={colors.ink}
            />
          </Pressable>

          <Animated.Text
            style={[styles.barTitle, { opacity: barTitleOpacity }]}
            numberOfLines={1}
            // Hidden from assistive tech: it is the same words as the large
            // title, which is already the screen's heading.
            importantForAccessibility="no"
            accessibilityElementsHidden
          >
            {barTitle || title}
          </Animated.Text>

          {/*
           * "System online" is the service-reachability indicator from the
           * mockups. The dot is never the only signal -- the words beside it
           * say which state it is in -- so it survives a monochrome display.
           */}
          <View style={styles.status} accessible accessibilityLabel="System online">
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>System online</Text>
          </View>
        </View>

        {body}

        {/*
         * A footer sits outside the scroller on purpose: One UI puts the
         * committing action at the bottom of the screen where the thumb is,
         * and a submit button that has to be scrolled to is a submit button
         * people miss.
         */}
        {footer ? (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
            {footer}
          </View>
        ) : null}
      </View>

      {/* The floating sidebar, above the content and its own scrim. */}
      {wide ? null : <Sidebar navigation={navigation} active={active} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.page },
  column: { flex: 1 },
  flex: { flex: 1 },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    backgroundColor: colors.surface,
    // A hairline rather than a shadow: One UI separates the bar from the page
    // with a line that appears only where the two actually meet.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.fieldBorder,
  },
  barButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TOUCH_TARGET / 2,
  },
  barTitle: {
    ...type.bodyMedium,
    fontFamily: type.button.fontFamily,
    fontSize: 16,
    color: colors.ink,
    flex: 1,
  },

  status: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 1, paddingRight: space.md },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  statusText: { ...type.caption, fontSize: 11, color: colors.success },

  scrollContent: { paddingHorizontal: space.lg },

  largeTitleBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.xl,
    paddingHorizontal: space.xs,
  },
  largeTitleText: { flex: 1, gap: 2 },
  eyebrow: { ...type.caption, color: colors.inkMuted },
  largeTitle: {
    fontFamily: type.hero.fontFamily,
    // One UI's large title is noticeably larger than a Material headline and
    // is allowed to wrap to two lines rather than being truncated.
    fontSize: 28,
    lineHeight: 36,
    color: colors.ink,
  },
  subtitle: { ...type.caption, color: colors.inkMuted, marginTop: 2 },

  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopLeftRadius: oneui.radius.sheet,
    borderTopRightRadius: oneui.radius.sheet,
    ...Platform.select({
      android: { elevation: 12 },
      default: {
        shadowColor: '#0b2033',
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
      },
    }),
  },
});
