import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import Chip, { RECIPIENT_STATUS } from '../../components/oneui/Chip';
import PillButton from '../../components/oneui/PillButton';
import { ListEmpty, ListError, ListSkeleton } from '../../components/oneui/ListState';
import CaregiverCard from '../../components/family/CaregiverCard';
import UpdateItem from '../../components/family/UpdateItem';
import RecipientSwitcher from '../../components/family/RecipientSwitcher';
import FamilyGate from '../../components/family/FamilyGate';
import useAsyncResource from '../../hooks/useAsyncResource';
import { family } from '../../api/family';
import { useAuth } from '../../auth/AuthContext';
import { useFamily } from '../../family/FamilyContext';
import { wellbeingFor } from '../../constants/wellbeing';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';
import { dayAndTime, greeting } from '../../utils/datetime';

/*
 * The family member's home: item 1 of issue #45.
 *
 * The whole screen is the answer to one question -- "is Mum alright?" -- and
 * it is laid out in the order that question is actually asked:
 *
 *   1. How is she?          the status card: status, the care team's own
 *                           summary, and how she was at the last visit
 *   2. When is someone next there?   the next visit
 *   3. Who is looking after her?     the caregiver, one tap from a call
 *   4. What has happened lately?     the three latest updates
 *
 * The first answer has to be complete without scrolling. Someone opening this
 * at 06:00 because they could not sleep should get "Stable, seemed well
 * yesterday at 11:04, 5 of 5 tasks done" before they have moved their thumb.
 */
export default function FamilyHomeScreen({ navigation }) {
  const { user } = useAuth();
  const { selected, displayName } = useFamily();
  const firstName = (user?.fullName || '').split(' ')[0];

  const load = useCallback(
    () => (selected ? family.overview(selected.id) : Promise.resolve(null)),
    [selected]
  );
  const overview = useAsyncResource(load, [selected?.id], { enabled: Boolean(selected) });
  const data = overview.data;
  const name = displayName(data?.recipient || selected);

  return (
    <PortalShell
      navigation={navigation}
      active="FamilyHome"
      barTitle="Home"
      eyebrow={firstName ? `${greeting()}, ${firstName}` : greeting()}
      title={selected ? name : 'Your family'}
      subtitle={selected ? [selected.relationship, selected.age ? `${selected.age} years` : null]
        .filter(Boolean).join(' · ') : null}
      titleTrailing={selected ? (
        <NotificationsBell
          unread={data?.unreadNotifications || 0}
          onPress={() => navigation.navigate('Notifications')}
        />
      ) : null}
      onRefresh={selected ? overview.reload : null}
      refreshing={overview.isRefreshing}
    >
      <FamilyGate>
        {() => (
          <View>
            <RecipientSwitcher />

            {overview.status === 'loading' ? (
              <ListSkeleton rows={3} height={130} />
            ) : !data ? (
              <ListError
                error={overview.error}
                onRetry={overview.reload}
                title={`Could not load ${name}'s updates`}
              />
            ) : (
              <View style={styles.sections}>
                {overview.status === 'error' ? (
                  <ListError error={overview.error} onRetry={overview.reload} title="Could not refresh" />
                ) : null}

                <StatusCard data={data} name={name} />

                {/* ── next visit ── */}
                <View>
                  <SectionHeading
                    action={(
                      <PillButton
                        label="Schedule"
                        iconRight="arrow-forward"
                        variant="quiet"
                        size="sm"
                        onPress={() => navigation.navigate('Schedule')}
                        accessibilityHint="Opens every upcoming visit"
                      />
                    )}
                  >
                    Next Visit
                  </SectionHeading>
                  {data.nextVisit ? (
                    <Card
                      onPress={() => navigation.navigate('Schedule')}
                      accessibilityLabel={
                        `Next visit ${dayAndTime(data.nextVisit.at)}. ${data.nextVisit.kind}`
                        + `${data.nextVisit.caregiver ? ` with ${data.nextVisit.caregiver}` : ''}.`
                      }
                    >
                      <View style={styles.nextRow}>
                        <View style={styles.nextIcon}>
                          <Ionicons name="calendar" size={18} color={colors.teal} />
                        </View>
                        <View style={styles.nextText}>
                          <Text style={styles.nextWhen}>{dayAndTime(data.nextVisit.at)}</Text>
                          <Text style={styles.nextMeta} numberOfLines={1}>
                            {[data.nextVisit.kind, data.nextVisit.caregiver].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.label} />
                      </View>
                    </Card>
                  ) : (
                    <ListEmpty
                      icon="calendar-outline"
                      title="No visit booked"
                      body="Nothing is on the schedule yet. The care team adds visits as they plan the week."
                    />
                  )}
                </View>

                {/* ── caregiver ── */}
                {data.caregiver ? (
                  <View>
                    <SectionHeading>Caregiver</SectionHeading>
                    <CaregiverCard caregiver={data.caregiver} />
                  </View>
                ) : null}

                {/* ── latest updates ── */}
                <View>
                  <SectionHeading
                    action={(
                      <PillButton
                        label="See all"
                        iconRight="arrow-forward"
                        variant="quiet"
                        size="sm"
                        onPress={() => navigation.navigate('CareUpdates')}
                        accessibilityHint="Opens the full care updates feed"
                      />
                    )}
                  >
                    Latest Updates
                  </SectionHeading>
                  {data.latestUpdates.length ? (
                    <View style={styles.stack}>
                      {data.latestUpdates.map((u) => (
                        <UpdateItem key={u.id} update={u} displayName={name} truncate />
                      ))}
                    </View>
                  ) : (
                    <ListEmpty
                      icon="pulse-outline"
                      title="No updates yet"
                      body={`After each visit, the caregiver's report on ${name} will appear here.`}
                    />
                  )}
                </View>

                {/* ── the care plan, one tap away ── */}
                <Card
                  onPress={() => navigation.navigate('CarePlan')}
                  accessibilityLabel={`${name}'s care plan`}
                  accessibilityHint="Opens the profile, medications and care team"
                >
                  <View style={styles.linkRow}>
                    <View style={[styles.nextIcon, { backgroundColor: colors.dangerBg }]}>
                      <Ionicons name="heart" size={18} color={colors.danger} />
                    </View>
                    <View style={styles.nextText}>
                      <Text style={styles.nextWhen}>Care plan</Text>
                      <Text style={styles.nextMeta}>Profile, medications and the care team</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.label} />
                  </View>
                </Card>
              </View>
            )}
          </View>
        )}
      </FamilyGate>
    </PortalShell>
  );
}

/*
 * The answer to "is she alright?", in one card.
 *
 * The status is the care team's (Stable / Needs attention), stated with its
 * icon and in words. Under it, the last visit in the caregiver's own terms --
 * the wellbeing they recorded, the tasks done -- because "Stable" from an
 * agency and "seemed well yesterday, all five tasks done" from the person who
 * was in the room are different kinds of reassurance, and the second is the
 * one people trust.
 */
function StatusCard({ data, name }) {
  const status = RECIPIENT_STATUS[data.recipient?.status] || RECIPIENT_STATUS.stable;
  const last = data.lastVisit;
  const mood = last?.visit ? wellbeingFor(last.visit.wellbeing) : null;

  return (
    <Card style={styles.status}>
      <View style={styles.statusHead}>
        <Text style={styles.statusLabel}>{`HOW ${name.toUpperCase()} IS DOING`}</Text>
        <Chip tone={status.tone} label={status.label} />
      </View>

      {data.recipient?.statusNote ? (
        <Text style={styles.statusNote}>{data.recipient.statusNote}</Text>
      ) : null}

      <Divider inset={0} />

      {last ? (
        <View
          style={styles.lastRow}
          accessible
          accessibilityLabel={
            `Last visit ${dayAndTime(last.at)}${last.author ? ` by ${last.author}` : ''}.`
            + `${mood ? ` Seemed ${mood.label.toLowerCase()}.` : ''}`
            + `${last.visit?.tasksTotal ? ` ${last.visit.tasksDone} of ${last.visit.tasksTotal} tasks done.` : ''}`
          }
        >
          {mood ? <Text style={styles.lastEmoji}>{mood.emoji}</Text> : null}
          <View style={styles.lastText}>
            <Text style={styles.lastTitle}>
              {mood ? `Seemed ${mood.label.toLowerCase()} at the last visit` : 'Last visit'}
            </Text>
            <Text style={styles.lastMeta}>
              {[
                dayAndTime(last.at),
                last.author,
                last.visit?.tasksTotal ? `${last.visit.tasksDone}/${last.visit.tasksTotal} tasks` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={styles.lastMeta}>No visits recorded yet.</Text>
      )}
    </Card>
  );
}

/** The bell in the title area, with the unread count stated rather than implied. */
function NotificationsBell({ unread, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.bell}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={22} color={colors.ink} />
      {unread ? (
        <View style={styles.badge} importantForAccessibility="no">
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },
  stack: { gap: space.md },

  status: { gap: space.md },
  statusHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  statusLabel: { ...type.label, fontSize: 10, color: colors.label, flexShrink: 1 },
  statusNote: { ...type.body, color: colors.ink },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lastEmoji: { fontSize: 28, lineHeight: 34 },
  lastText: { flex: 1, gap: 2 },
  lastTitle: { ...type.bodyMedium, fontSize: 14, color: colors.ink },
  lastMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted },

  nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nextIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { flex: 1, gap: 2 },
  nextWhen: { ...type.bodyMedium, color: colors.ink },
  nextMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted },

  bell: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: oneui.radius.inner,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 7,
    right: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: type.button.fontFamily, fontSize: 10, color: colors.surface },
});
