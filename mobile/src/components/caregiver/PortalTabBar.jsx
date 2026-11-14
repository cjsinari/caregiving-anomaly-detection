import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Touchable from '../oneui/Touchable';
import { usePortalChrome } from './PortalChrome';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * The bottom tab bar both portals use (#46).
 *
 * ── It shares the job with the sidebar, by screen width ──
 *
 * On a phone held upright the sidebar is folded away (see PortalChrome), and a
 * caregiver moving between Home and Assignments forty times a shift should not
 * have to open a drawer to do it. So on a phone the tabs are the navigation,
 * under the thumb where One UI puts everything that is touched; the sidebar is
 * still there behind the menu button for the destinations that are not tabs
 * (Notifications, for a family member).
 *
 * On a tablet or in landscape the sidebar is permanently open and *is* the
 * navigation, and a tab bar under it would offer the same four destinations a
 * second time. So this draws nothing there.
 *
 * ── Drawn from the portal definition ──
 *
 * Icons and labels come from the same list the sidebar uses (portals.js), so
 * the two cannot drift: renaming "Visit Report" changes both, and a tab cannot
 * point somewhere the sidebar does not.
 *
 * ── The active tab ──
 *
 * Shown by a filled icon in a tinted pill *and* a heavier label, not colour
 * alone. Announced as a tab with `selected`, so a screen reader says "Home,
 * tab, 1 of 4, selected" rather than reading four anonymous buttons.
 */
export default function PortalTabBar({ state, navigation, insets }) {
  const { portal, wide } = usePortalChrome();
  if (wide) return null;

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets?.bottom || 0, space.sm) }]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const item = portal.items.find((i) => i.route === route.name);
        if (!item) return null;
        const focused = state.index === index;
        const label = item.tabLabel || item.label;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };

        return (
          <Touchable
            key={route.key}
            onPress={onPress}
            scale={false}
            style={styles.tab}
            borderless
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            accessibilityHint={focused ? undefined : item.hint}
          >
            <View style={[styles.pill, focused && styles.pillActive]}>
              <Ionicons
                name={focused ? item.iconActive : item.icon}
                size={21}
                color={focused ? colors.teal : colors.inkMuted}
              />
            </View>
            <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.fieldBorder,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET + 6,
    gap: 2,
  },
  pill: {
    width: 56,
    height: 30,
    borderRadius: oneui.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.tealSoft },
  label: { ...type.caption, fontSize: 11, lineHeight: 14, color: colors.inkMuted },
  labelActive: { fontFamily: type.button.fontFamily, color: colors.ink },
});
