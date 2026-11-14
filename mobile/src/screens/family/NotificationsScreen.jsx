import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider } from '../../components/oneui/Card';
import PillButton from '../../components/oneui/PillButton';
import Banner from '../../components/Banner';
import ListState, { ListError } from '../../components/oneui/ListState';
import useAsyncResource from '../../hooks/useAsyncResource';
import { family } from '../../api/family';
import { useFamily } from '../../family/FamilyContext';
import { useAccount } from '../../account/AccountContext';
import { useGoTo } from '../../navigation/routes';
import { colors, space, type } from '../../theme/tokens';
import { dayAndTime } from '../../utils/datetime';

/*
 * Everything the app has told this person: item 6 of issue #45.
 *
 * ── Two kinds of notice, one list ──
 *
 * Care notifications (a visit completed, an incident, a visit moved) and the
 * service's account notices (a new device added, a session ended for your
 * safety) arrive from different places -- see api/family.js -- and are shown
 * together, newest first, each with its own icon. Splitting them into two tabs
 * would put the "someone signed in to your account from Lagos" notice behind
 * a tab nobody opens.
 *
 * ── What muting does, and does not, do ──
 *
 * A category switched off in Account is left out of this list, and the
 * list says so -- "Completed visits are hidden" -- with the way to undo it.
 * A list that silently omits things is a list people stop trusting. Incidents
 * and account notices are never hidden: the service lists them as always on
 * and refuses to let them be muted (AccountContext). Muting also
 * never hides anything from the care updates feed: that is the record, and
 * this is only the alerts about it.
 */
const ICONS = {
  visit: { name: 'checkmark-circle', tint: colors.success, bg: colors.successBg },
  note: { name: 'document-text', tint: colors.info, bg: colors.infoBg },
  incident: { name: 'warning', tint: colors.warning, bg: colors.warningBg },
  schedule: { name: 'calendar', tint: colors.teal, bg: colors.tealSoft },
  account: { name: 'shield-checkmark', tint: colors.navy, bg: colors.field },
};

export default function NotificationsScreen({ navigation }) {
  const { recipients, displayName } = useFamily();
  const { prefs, isMuted } = useAccount();
  const goTo = useGoTo(navigation);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState(null);

  const load = useCallback(() => family.notifications(), []);
  const { status, data, error, isRefreshing, reload, setData } = useAsyncResource(load);

  const all = data?.items || [];
  const visible = useMemo(() => all.filter((n) => !isMuted(n.category)), [all, isMuted]);
  const hiddenCategories = (prefs?.categories || []).filter((c) => c.enabled === false);
  const unread = visible.filter((n) => !n.readAt).length;

  const nameFor = (recipientId) => {
    if (!recipientId || recipients.length < 2) return null;
    const r = recipients.find((x) => x.id === recipientId);
    return r ? displayName(r) : null;
  };

  /*
   * Mark everything read.
   *
   * Drawn as read straight away and put back if the service refuses, the same
   * optimistic shape as ticking a task in #44 -- with the difference that the
   * rollback here is all-or-nothing, because so is the request.
   */
  const markAll = async () => {
    const before = data;
    setMarking(true);
    setMarkError(null);
    const stamp = new Date().toISOString();
    setData((current) => (current ? {
      ...current,
      items: current.items.map((n) => (n.readAt ? n : { ...n, readAt: stamp })),
    } : current));
    try {
      await family.markNotificationsRead();
    } catch (err) {
      setData(before);
      setMarkError(err?.message || 'Could not mark them read. Please try again.');
    } finally {
      setMarking(false);
    }
  };

  return (
    <PortalShell
      navigation={navigation}
      active="Notifications"
      barTitle="Notifications"
      title="Notifications"
      // Pushed over the tabs since #46, reached from the bell on Home.
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : goTo('FamilyHome'))}
      subtitle={status === 'loading' ? 'Loading…' : unread ? `${unread} unread` : 'All caught up'}
      titleTrailing={unread ? (
        <PillButton
          label="Mark all read"
          variant="tonal"
          size="sm"
          onPress={markAll}
          loading={marking}
        />
      ) : null}
      onRefresh={reload}
      refreshing={isRefreshing}
    >
      <View style={styles.stack}>
        {markError ? <Banner tone="error" title="Not updated">{markError}</Banner> : null}

        {data?.partial === 'account' ? (
          <Banner tone="warning" title="Account notices did not load">
            Care notifications are shown below, but your account security notices could not be
            fetched. Pull down to try again.
          </Banner>
        ) : null}
        {data?.partial === 'care' ? (
          <Banner tone="warning" title="Care notifications did not load">
            Your account notices are shown below, but care notifications could not be fetched.
            Pull down to try again.
          </Banner>
        ) : null}

        {status === 'error' && data ? (
          <ListError error={error} onRetry={reload} title="Could not refresh" />
        ) : null}

        {hiddenCategories.length && status !== 'loading' ? (
          <View style={styles.hidden} accessible accessibilityRole="text">
            <Ionicons name="eye-off-outline" size={14} color={colors.inkMuted} />
            <Text style={styles.hiddenText}>
              {`${hiddenCategories.map((c) => c.label).join(' and ')} `}
              {hiddenCategories.length === 1 ? 'is' : 'are'}
              {' hidden by your settings. Change this in Account.'}
            </Text>
          </View>
        ) : null}

        <ListState
          status={status}
          error={error}
          isEmpty={!visible.length}
          onRetry={reload}
          skeletonRows={4}
          skeletonHeight={72}
          empty={{
            icon: 'notifications-off-outline',
            title: 'No notifications',
            body: 'When a visit is completed or something needs your attention, you will hear about it here.',
          }}
        >
          <Card padded={false}>
            {visible.map((n, i) => {
              const icon = ICONS[n.category] || ICONS.visit;
              const who = nameFor(n.recipientId);
              const isUnread = !n.readAt;
              return (
                <View key={n.id}>
                  {i > 0 ? <Divider inset={space.lg + 46} /> : null}
                  <View
                    style={[styles.row, isUnread && styles.rowUnread]}
                    accessible
                    accessibilityLabel={
                      `${isUnread ? 'Unread. ' : ''}${n.title}${who ? `, ${who}` : ''}. `
                      + `${n.message} ${dayAndTime(n.createdAt)}.`
                    }
                  >
                    <View style={[styles.icon, { backgroundColor: icon.bg }]}>
                      <Ionicons name={icon.name} size={16} color={icon.tint} />
                    </View>
                    <View style={styles.body}>
                      <View style={styles.titleRow}>
                        <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={1}>
                          {n.title}
                        </Text>
                        {/* Unread is a dot *and* weight, not the dot alone. */}
                        {isUnread ? <View style={styles.dot} /> : null}
                      </View>
                      <Text style={styles.message}>{n.message}</Text>
                      <Text style={styles.when}>
                        {[dayAndTime(n.createdAt), who, n.category === 'account' ? 'Account' : null]
                          .filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </Card>
        </ListState>
      </View>
    </PortalShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  hidden: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.xs },
  hiddenText: { ...type.caption, fontSize: 12, color: colors.inkMuted, flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
  },
  rowUnread: { backgroundColor: '#f7fbfa' },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...type.body, fontSize: 14, color: colors.ink, flexShrink: 1 },
  titleUnread: { fontFamily: type.button.fontFamily },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal },
  message: { ...type.caption, color: colors.inkMuted },
  when: { ...type.caption, fontSize: 11, color: colors.placeholder },
});
