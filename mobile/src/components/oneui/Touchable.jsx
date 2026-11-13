import { useCallback, useMemo, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet } from 'react-native';
import { oneui } from '../../theme/tokens';

/*
 * A press, the way One UI does a press.
 *
 * One UI's feedback is a short inward scale -- the thing you touched shrinks a
 * little under your finger and springs back. Android's own ripple is still
 * there underneath on Android, because removing it would make the app feel
 * foreign on the platform it is built for; the scale is layered on top rather
 * than instead.
 *
 * ── Why this is a component and not three lines in each screen ──
 *
 * Because it is three lines in each of about forty places, and because the
 * accessibility part is the half that gets dropped: anything that takes a tap
 * needs a role, a name and a minimum height, and a bare Animated.View with an
 * onTouchEnd has none of the three. Routing every tappable surface through
 * here means there is one place that can be got wrong, and one place to fix
 * when the #47 accessibility pass finds something.
 *
 * ── Why the style is split in two ──
 *
 * The scale has to be animated on a wrapper, because transforming the
 * Pressable itself fights with the ripple's bounds on Android. That wrapper
 * then sits between this component's caller and the thing being laid out --
 * and `flex: 1`, `alignSelf: 'stretch'` and the margins belong to *it*, not to
 * the Pressable inside it.
 *
 * Left unsplit, this breaks quietly and in a way that is easy to misread as a
 * design problem rather than a bug: a `flex: 1` stat tile in a row of three
 * shrinks to its text while its two non-pressable neighbours expand, and a
 * `full`-width button stops being full width. So the layout properties are
 * lifted to the wrapper and everything else -- padding, background, radius,
 * borders, the minimum touch target -- stays on the Pressable, which is where
 * it has to be for the ripple to be clipped correctly.
 */

/*
 * The properties that position a box within its parent, as opposed to the
 * ones that paint it. Width and height are included because a sized wrapper
 * whose child is a different size is the same bug in a different direction.
 */
const LAYOUT_PROPS = [
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'bottom', 'left', 'right', 'zIndex',
];

function splitStyle(style) {
  const flat = StyleSheet.flatten(style) || {};
  const outer = {};
  const inner = {};

  for (const [key, value] of Object.entries(flat)) {
    if (LAYOUT_PROPS.includes(key)) outer[key] = value;
    else inner[key] = value;
  }

  /*
   * A height given to the wrapper has to be honoured by the Pressable too, or
   * the painted surface is smaller than the space reserved for it. `minHeight`
   * is the common case -- every touch target in this app carries one.
   */
  if (outer.minHeight != null) inner.minHeight = outer.minHeight;
  if (outer.height != null) inner.height = outer.height;
  if (outer.flex != null || outer.flexGrow != null || outer.alignSelf === 'stretch') {
    inner.flex = 1;
  }

  return { outer, inner };
}

export default function Touchable({
  children,
  onPress,
  onLongPress,
  disabled = false,
  style,
  scale = true,
  rippleColor = 'rgba(20, 40, 61, 0.10)',
  borderless = false,
  hitSlop,
  ...a11y
}) {
  const value = useRef(new Animated.Value(1)).current;
  const { outer, inner } = useMemo(() => splitStyle(style), [style]);

  const to = useCallback((target) => {
    if (!scale || disabled) return;
    Animated.timing(value, {
      toValue: target,
      duration: oneui.motion.fast,
      useNativeDriver: true,
    }).start();
  }, [scale, disabled, value]);

  return (
    <Animated.View style={[outer, { transform: [{ scale: value }] }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        onPressIn={() => to(oneui.pressScale)}
        onPressOut={() => to(1)}
        hitSlop={hitSlop}
        android_ripple={
          Platform.OS === 'android' ? { color: rippleColor, borderless } : undefined
        }
        // iOS has no ripple, so it gets a dim on press instead -- otherwise a
        // small control would animate and never change colour.
        style={({ pressed }) => [
          inner,
          Platform.OS === 'ios' && pressed && !disabled && { opacity: 0.72 },
        ]}
        accessibilityState={{ disabled, ...(a11y.accessibilityState || {}) }}
        {...a11y}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
