import { StyleSheet, Text, View } from 'react-native';
import { colors, oneui, type } from '../../theme/tokens';
import { initials } from '../../utils/datetime';

/*
 * The initials tile beside every name.
 *
 * ── Why initials and not a photograph ──
 *
 * Partly that there are no photographs to show: the service stores none, and
 * adding them would mean storing a picture of an elderly person's face
 * alongside their address and their medication list, which is a data
 * protection question nobody has asked for an answer to.
 *
 * Mostly, though, it is that this app is used in public. A caregiver checks
 * their next visit on a matatu. Initials and a first name are enough to tell
 * three people apart at a glance and are close to meaningless to whoever is
 * sitting next to them; a photograph is not.
 *
 * ── Why it is invisible to a screen reader ──
 *
 * "M W" read out before "Margaret Wanjiku" is noise. The name is always
 * directly beside it, so the tile is decoration and is marked as such.
 */
const SIZES = {
  sm: { box: 34, radius: 12, text: 12 },
  md: { box: 44, radius: 15, text: 14 },
  lg: { box: 58, radius: 20, text: 18 },
};

export default function Avatar({ name, size = 'md', tone = 'navy', style }) {
  const s = SIZES[size] || SIZES.md;
  const background = tone === 'teal' ? colors.teal : colors.navy;

  return (
    <View
      style={[
        styles.tile,
        { width: s.box, height: s.box, borderRadius: s.radius, backgroundColor: background },
        style,
      ]}
      importantForAccessibility="no"
      accessibilityElementsHidden
    >
      <Text style={[styles.text, { fontSize: s.text }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    // One UI rounds a square tile hard enough that it reads as a squircle
    // rather than as a rounded rectangle, which is why these radii are so
    // close to half the box.
    borderCurve: 'continuous',
  },
  text: {
    fontFamily: type.button.fontFamily,
    color: colors.onNavy,
    letterSpacing: 0.4,
  },
});

export const AVATAR_RADIUS = oneui.radius.inner;
