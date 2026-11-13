import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PillButton from './PillButton';
import { Card } from './Card';
import { colors, oneui, space, type } from '../../theme/tokens';

/*
 * Loading, empty, and error — the three states item 7 of issue #44 asks every
 * list on these screens to have.
 *
 * ── Why one component and not three per screen ──
 *
 * Five lists times three states is fifteen branches, and the error branch is
 * always the one that does not get written. Funnelling them through here means
 * a list either hands over its state or it does not compile into anything, and
 * the error state cannot be the one somebody forgot.
 *
 * ── Skeletons, not a spinner, for the first load ──
 *
 * A spinner on a blank screen tells you nothing except that you are waiting.
 * A skeleton in the shape of the list tells you what is coming and how much of
 * it, and when the real content lands it does not jump, because it was already
 * laid out at roughly the right height. The pulse is opacity-only and runs on
 * the native driver, so it costs nothing on the mid-range phones this app
 * targets.
 *
 * ── Three different empties ──
 *
 * "You have no assignments yet" and "No match for 'wanjik'" are not the same
 * sentence and must not be rendered by the same branch. The first is a state
 * of the account and the caregiver can do nothing about it; the second is a
 * state of the search box and clearing it fixes it. Telling someone with a
 * typo that they have no patients is how a search box gets reported as a data
 * loss bug.
 */

/** The first load: a shape, not a spinner. */
export function ListSkeleton({ rows = 3, height = 84 }) {
  return (
    <View
      style={styles.skeletonWrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessibilityState={{ busy: true }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <View
          // Fixed-length placeholder list: the index is the only identity a
          // skeleton row has, and the list never reorders.
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={[styles.skeletonRow, { height }]}
        />
      ))}
    </View>
  );
}

/** A reload that failed, with the one button that matters. */
export function ListError({ error, onRetry, title = 'Could not load this' }) {
  const message = error?.message || 'Something went wrong. Please try again.';
  // A dead network is worth distinguishing: "check your connection" is
  // actionable, "the service is unavailable" is not.
  const offline = error?.isNetwork || error?.code === 'NETWORK' || error?.code === 'TIMEOUT';

  return (
    <Card style={styles.state}>
      <View
        style={[styles.icon, { backgroundColor: colors.dangerBg }]}
        importantForAccessibility="no"
      >
        <Ionicons
          name={offline ? 'cloud-offline' : 'alert-circle'}
          size={24}
          color={colors.danger}
        />
      </View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.body} accessibilityLiveRegion="polite">{message}</Text>
      {onRetry ? (
        <PillButton label="Try again" icon="refresh" variant="tonal" onPress={onRetry} />
      ) : null}
    </Card>
  );
}

/** Nothing here, and the reason why. */
export function ListEmpty({
  icon = 'file-tray-outline',
  title = 'Nothing here yet',
  body,
  action = null,
}) {
  return (
    <Card style={styles.state}>
      <View style={[styles.icon, { backgroundColor: colors.field }]} importantForAccessibility="no">
        <Ionicons name={icon} size={24} color={colors.label} />
      </View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action}
    </Card>
  );
}

/**
 * The whole decision, in one place.
 *
 * A screen hands over its resource and its empty copy and gets back either the
 * right state or its own children. The order of the checks is the part worth
 * reading: a *failed reload that still has data* renders the data, with the
 * error as a banner above it (the screen's job), because stale visits beat no
 * visits. Only a failure with nothing to fall back on takes the screen.
 */
export default function ListState({
  status,
  error,
  isEmpty,
  onRetry,
  skeletonRows = 3,
  skeletonHeight = 84,
  empty = {},
  children,
}) {
  if (status === 'loading') {
    return <ListSkeleton rows={skeletonRows} height={skeletonHeight} />;
  }
  if (status === 'error' && isEmpty) {
    return <ListError error={error} onRetry={onRetry} />;
  }
  if (isEmpty) {
    return <ListEmpty {...empty} />;
  }
  return children;
}

const styles = StyleSheet.create({
  skeletonWrap: { gap: space.md },
  skeletonRow: {
    backgroundColor: colors.surface,
    borderRadius: oneui.radius.card,
    opacity: 0.55,
  },

  state: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: oneui.radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.title, fontSize: 17, lineHeight: 24, color: colors.ink, textAlign: 'center' },
  body: { ...type.caption, color: colors.inkMuted, textAlign: 'center', maxWidth: 300 },
});
