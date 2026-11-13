import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { SectionHeading, Divider } from '../../components/oneui/Card';
import Chip, { RECIPIENT_STATUS, VISIT_STATUS } from '../../components/oneui/Chip';
import Avatar from '../../components/oneui/Avatar';
import StatTile from '../../components/oneui/StatTile';
import PillButton from '../../components/oneui/PillButton';
import Touchable from '../../components/oneui/Touchable';
import ListState, { ListError } from '../../components/oneui/ListState';
import useAsyncResource from '../../hooks/useAsyncResource';
import { care } from '../../api/caregiver';
import { useAuth } from '../../auth/AuthContext';
import { colors, oneui, shadow, space, type } from '../../theme/tokens';
import { dayAndTime, greeting, longDate, time } from '../../utils/datetime';

/*
 * The caregiver's day: item 1 of issue #44.
 *
 * Three questions, in the order a caregiver actually asks them when they open
 * the app standing at a bus stop:
 *
 *   1. Is anything wrong?          the alert band, at the top, only when there is one
 *   2. Where am I going next?      the visit schedule
 *   3. Who am I looking after?     the assigned profiles
 *
 * The mockup puts the profiles above the schedule and that is what is built,
 * because the profile strip doubles as the way into each person's record and
 * burying it under a list of times would make the record hard to reach. The
 * alerts are the one thing placed above the mockup's layout: an alert nobody
 * scrolls to is an alert that did not happen.
 *
 * ── One request, not four ──
 *
 * Counts, profiles, schedule and alerts arrive together from care.dashboard().
 * Four independent loaders would mean four skeletons resolving at four
 * different moments on a slow connection, which reads as a page assembling
 * itself out of order. One loader means one skeleton, one error and one
 * pull-to-refresh that genuinely refreshes everything.
 */
export default function CaregiverHomeScreen({ navigation }) {
  const { user } = useAuth();

  const load = useCallback(() => care.dashboard(), []);
  const { status, data, error, isRefreshing, reload } = useAsyncResource(load);

  const firstName = (user?.fullName || '').split(' ')[0] || 'there';
  const counts = data?.counts || { assigned: 0, visitsToday: 0, completedToday: 0 };
  const recipients = data?.recipients || [];
  const visits = data?.visits || [];
  const alerts = data?.alerts || [];

  const openRecipient = (id) => navigation.navigate('RecipientDetail', { recipientId: id });

  /*
   * "Check in" opens the visit report with the check-in already happening.
   *
   * The alternative -- check in here, then navigate -- leaves the caregiver
   * looking at a dashboard for the second the request takes, with no sign of
   * where they are going. Starting the navigation first and letting the
   * report screen own the call means the time is recorded against the moment
   * the button was pressed either way, and the screen that shows the result is
   * the screen already on display when it arrives.
   */
  const checkIn = (visit) => navigation.navigate('VisitReport', {
    visitId: visit.id,
    recipientId: visit.recipientId,
    autoCheckIn: !visit.checkInAt,
  });

  return (
    <PortalShell
      navigation={navigation}
      active="Home"
      barTitle="Home"
      eyebrow={`${greeting()},`}
      title={user?.fullName || 'Caregiver'}
      subtitle={longDate()}
      titleTrailing={data?.sessionRisk ? <RiskBadge risk={data.sessionRisk} /> : null}
      onRefresh={reload}
      refreshing={isRefreshing}
    >
      {/* A failed reload that still has yesterday's data on screen says so
          here, above the content, rather than replacing it. */}
      {status === 'error' && data ? (
        <View style={styles.inlineError}>
          <ListError
            error={error}
            onRetry={reload}
            title="Could not refresh"
          />
        </View>
      ) : null}

      {/* ── counters ── */}
      {status === 'loading' ? (
        <View style={styles.statRow}>
          {[0, 1, 2].map((i) => <View key={i} style={styles.statSkeleton} />)}
        </View>
      ) : (
        <View style={styles.statRow}>
          <StatTile
            value={counts.assigned}
            label="Assigned Elders"
            onPress={() => navigation.navigate('Assignments')}
            accessibilityLabel={`${counts.assigned} assigned elders. Opens your assignments.`}
          />
          <StatTile value={counts.visitsToday} label="Visits Today" />
          <StatTile value={counts.completedToday} label="Completed Today" />
        </View>
      )}

      {/* ── alerts ── */}
      {alerts.length ? (
        <View style={styles.section}>
          <SectionHeading>Alerts</SectionHeading>
          <View style={styles.stack}>
            {alerts.map((alert) => (
              <Card
                key={alert.id}
                style={styles.alert}
                onPress={alert.recipientId ? () => openRecipient(alert.recipientId) : undefined}
                accessibilityLabel={`Alert. ${alert.title}. ${alert.body}`}
                accessibilityHint={alert.recipientId ? 'Opens the care record' : undefined}
              >
                <View style={styles.alertRow}>
                  <View style={styles.alertIcon}>
                    <Ionicons name="alert-circle" size={18} color={colors.warning} />
                  </View>
                  <View style={styles.alertBody}>
                    <Text style={styles.alertTitle}>{alert.title}</Text>
                    <Text style={styles.alertText}>{alert.body}</Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      {/* ── assigned profiles ── */}
      <View style={styles.section}>
        <SectionHeading
          action={(
            <PillButton
              label="View all"
              iconRight="arrow-forward"
              variant="quiet"
              size="sm"
              onPress={() => navigation.navigate('Assignments')}
              accessibilityHint="Opens the full list of people you are assigned to"
            />
          )}
        >
          Assigned Profiles
        </SectionHeading>

        <ListState
          status={status}
          error={error}
          isEmpty={!recipients.length}
          onRetry={reload}
          skeletonRows={1}
          skeletonHeight={132}
          empty={{
            icon: 'people-outline',
            title: 'No assignments yet',
            body: 'When a family member adds you to someone’s care team, they will appear here.',
          }}
        >
          {/*
           * A horizontal strip, as the mockup draws it. The cards are capped
           * at 74% of the screen so the next one is always partly visible --
           * a row of cards that happens to end exactly at the screen edge
           * looks like the whole list, and nobody swipes it.
           */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            // Snaps so the strip comes to rest on a card rather than between two.
            snapToInterval={262 + space.md}
            decelerationRate="fast"
          >
            {recipients.map((person) => {
              const statusInfo = RECIPIENT_STATUS[person.status] || RECIPIENT_STATUS.stable;
              return (
                <Card
                  key={person.id}
                  style={styles.profileCard}
                  onPress={() => openRecipient(person.id)}
                  accessibilityLabel={
                    `${person.fullName}, ${person.age} years, ${(person.conditions || []).join(', ')}. `
                    + `${statusInfo.label}.`
                    + (person.nextVisitAt ? ` Next visit ${dayAndTime(person.nextVisitAt)}.` : '')
                  }
                  accessibilityHint="Opens the care record"
                >
                  <View style={styles.profileTop}>
                    <Avatar name={person.fullName} size="md" />
                    <Chip tone={statusInfo.tone} label={statusInfo.label} compact />
                  </View>

                  <Text style={styles.profileName} numberOfLines={1}>{person.fullName}</Text>
                  <Text style={styles.profileMeta} numberOfLines={1}>
                    {[person.age ? `${person.age} years` : null, (person.conditions || []).join(' · ')]
                      .filter(Boolean).join(' · ')}
                  </Text>

                  <Divider inset={0} />

                  <View style={styles.profileFoot}>
                    <Ionicons name="calendar-outline" size={14} color={colors.link} />
                    <Text style={styles.profileNext} numberOfLines={1}>
                      {person.nextVisitAt ? dayAndTime(person.nextVisitAt) : 'No visit scheduled'}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </ScrollView>
        </ListState>
      </View>

      {/* ── visit schedule ── */}
      <View style={styles.section}>
        <SectionHeading
          action={(
            <PillButton
              label="New Report"
              icon="add"
              variant="solid"
              size="sm"
              onPress={() => navigation.navigate('NewReport')}
              accessibilityHint="Choose someone and start a visit report"
            />
          )}
        >
          Visit Schedule
        </SectionHeading>

        <ListState
          status={status}
          error={error}
          isEmpty={!visits.length}
          onRetry={reload}
          skeletonRows={2}
          skeletonHeight={76}
          empty={{
            icon: 'calendar-outline',
            title: 'Nothing scheduled today',
            body: 'Visits added to your round will show up here with a check-in button.',
          }}
        >
          <Card padded={false}>
            {visits.map((visit, index) => {
              const visitStatus = VISIT_STATUS[visit.status] || VISIT_STATUS.upcoming;
              const done = visit.status === 'completed';

              return (
                <View key={visit.id}>
                  {index > 0 ? <Divider inset={space.lg + 54} /> : null}
                  <Touchable
                    onPress={() => checkIn(visit)}
                    scale={false}
                    style={styles.visitRow}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `${time(visit.scheduledFor)}, ${visit.recipientName}. ${visitStatus.label}. `
                      + `${visit.kind}${visit.location ? `, ${visit.location}` : ''}.`
                    }
                    accessibilityHint={done ? 'Opens the filed visit report' : 'Checks you in and opens the visit report'}
                  >
                    <Text style={styles.visitTime}>{time(visit.scheduledFor)}</Text>
                    <View style={styles.visitRule} />

                    <View style={styles.visitBody}>
                      <View style={styles.visitNameRow}>
                        <Text style={styles.visitName} numberOfLines={1}>{visit.recipientName}</Text>
                        <Chip tone={visitStatus.tone} label={visitStatus.label} compact />
                      </View>
                      <Text style={styles.visitMeta} numberOfLines={1}>
                        {[visit.kind, visit.location].filter(Boolean).join(' · ')}
                      </Text>
                    </View>

                    <View style={styles.visitAction} importantForAccessibility="no">
                      <Text style={[styles.visitActionText, done && styles.visitActionDone]}>
                        {done ? 'View' : visit.checkInAt ? 'Resume' : 'Check in'}
                      </Text>
                      <Ionicons
                        name="arrow-forward"
                        size={14}
                        color={done ? colors.inkMuted : colors.link}
                      />
                    </View>
                  </Touchable>
                </View>
              );
            })}
          </Card>
        </ListState>
      </View>
    </PortalShell>
  );
}

/*
 * The SESSION RISK badge.
 *
 * It belongs to the risk engine, which scores the session on the service side.
 * Nothing on the mobile API returns it yet -- /auth/me carries identity, not
 * risk -- so this renders only when the source actually supplies one. The
 * alternative, defaulting to "Low Risk", would be the app telling a caregiver
 * their session is safe on no evidence whatsoever, which is worse than silence.
 */
function RiskBadge({ risk }) {
  const tone = risk.level === 'high' ? colors.danger
    : risk.level === 'medium' ? colors.warning
      : colors.success;

  return (
    <View
      style={styles.risk}
      accessible
      accessibilityLabel={`Session risk: ${risk.label}`}
    >
      <Text style={styles.riskLabel}>SESSION RISK</Text>
      <View style={styles.riskRow}>
        <Text style={[styles.riskValue, { color: tone }]}>{risk.label}</Text>
        <View style={[styles.riskDot, { backgroundColor: tone }]} />
      </View>
    </View>
  );
}

const CARD_WIDTH = 262;

const styles = StyleSheet.create({
  inlineError: { marginBottom: space.lg },

  risk: {
    backgroundColor: colors.surface,
    borderRadius: oneui.radius.inner,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 1,
    ...shadow.card,
  },
  riskLabel: { ...type.label, fontSize: 9, color: colors.label },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  riskValue: { ...type.captionMedium, fontSize: 12 },
  riskDot: { width: 7, height: 7, borderRadius: 4 },

  statRow: { flexDirection: 'row', gap: space.md, marginBottom: space.xl },
  statSkeleton: {
    flex: 1,
    minHeight: 86,
    borderRadius: oneui.radius.card - 4,
    backgroundColor: colors.surface,
    opacity: 0.55,
  },

  section: { marginBottom: space.xl },
  stack: { gap: space.md },

  alert: { paddingVertical: space.lg },
  alertRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  alertIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBody: { flex: 1, gap: 2 },
  alertTitle: { ...type.bodyMedium, fontSize: 14, color: colors.ink },
  alertText: { ...type.caption, color: colors.inkMuted },

  strip: { gap: space.md, paddingRight: space.lg, paddingVertical: 2 },
  profileCard: { width: CARD_WIDTH, gap: space.sm },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  profileName: { ...type.title, fontSize: 16, lineHeight: 22, color: colors.ink },
  profileMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted, marginTop: -2 },
  profileFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  profileNext: { ...type.captionMedium, fontSize: 12, color: colors.link, flex: 1 },

  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg - 2,
  },
  visitTime: {
    ...type.bodyMedium,
    fontSize: 14,
    color: colors.ink,
    width: 42,
    // Tabular-ish: a fixed width keeps 09:00 and 16:30 on the same left edge,
    // which is what makes the column scannable.
    letterSpacing: 0.2,
  },
  visitRule: { width: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: colors.tealSoft },
  visitBody: { flex: 1, gap: 2 },
  visitNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  visitName: { ...type.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
  visitMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  visitAction: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  visitActionText: { ...type.captionMedium, fontSize: 12, color: colors.link },
  visitActionDone: { color: colors.inkMuted },
});
