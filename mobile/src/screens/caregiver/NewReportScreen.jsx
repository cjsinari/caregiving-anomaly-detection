import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import Chip, { RECIPIENT_STATUS } from '../../components/oneui/Chip';
import Avatar from '../../components/oneui/Avatar';
import SearchField from '../../components/oneui/SearchField';
import PillButton from '../../components/oneui/PillButton';
import Touchable from '../../components/oneui/Touchable';
import ListState from '../../components/oneui/ListState';
import useAsyncResource from '../../hooks/useAsyncResource';
import { care } from '../../api/caregiver';
import { colors, space, type } from '../../theme/tokens';
import { dayAndTime, time } from '../../utils/datetime';

/*
 * New Report: choose who the report is for, then open a blank one for them.
 *
 * ── Why a chooser and not a blank form ──
 *
 * "New Report" on the dashboard cannot open a report, because a visit report
 * is always *about someone* and nothing in the tap says who. The alternatives
 * are a dropdown at the top of an otherwise-blank form -- which is a chooser
 * in a worse place, and lets someone fill in an entire report before
 * discovering they never picked a name -- or defaulting to the next scheduled
 * visit, which silently files a report against the wrong person the first
 * time somebody is seen out of order.
 *
 * So: one screen, one decision, and the report that opens is already bound to
 * a person.
 *
 * ── Two lists, because there are two reasons to be here ──
 *
 * Nearly always it is "I have just finished the 14:00" -- so today's open
 * visits come first, each with its time, and picking one opens the report
 * attached to that visit with its checklist already on it. Occasionally it is
 * an unscheduled call-in, so the full caseload is underneath, and picking from
 * there opens a report bound to the person with no visit behind it.
 *
 * The distinction matters, so the two lists are visibly different rather than
 * merged into one list of names.
 */
export default function NewReportScreen({ navigation }) {
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const [assignments, schedule] = await Promise.all([
      care.assignments(),
      care.visits(),
    ]);
    return { recipients: assignments.recipients, visits: schedule.visits };
  }, []);

  const { status, data, error, isRefreshing, reload } = useAsyncResource(load);

  const recipients = data?.recipients || [];

  /** Today's visits that have not been filed yet. */
  const openToday = useMemo(() => {
    const today = new Date();
    return (data?.visits || []).filter((v) => {
      if (v.status === 'completed') return false;
      const when = new Date(v.scheduledFor);
      return when.getFullYear() === today.getFullYear()
        && when.getMonth() === today.getMonth()
        && when.getDate() === today.getDate();
    });
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter((p) => String(p.fullName).toLowerCase().includes(q));
  }, [recipients, query]);

  const openForVisit = (visit) => navigation.navigate('VisitReport', {
    visitId: visit.id,
    recipientId: visit.recipientId,
  });

  const openForPerson = (person) => navigation.navigate('VisitReport', {
    recipientId: person.id,
  });

  return (
    <PortalShell
      navigation={navigation}
      active="VisitReport"
      barTitle="New Report"
      title="New Visit Report"
      subtitle="Who is this report for?"
      onBack={navigation.canGoBack() ? () => navigation.goBack() : null}
      onRefresh={reload}
      refreshing={isRefreshing}
    >
      <ListState
        status={status}
        error={error}
        isEmpty={!recipients.length}
        onRetry={reload}
        skeletonRows={3}
        skeletonHeight={96}
        empty={{
          icon: 'people-outline',
          title: 'Nobody to report on yet',
          body: 'A visit report is written about someone on your caseload, and you have '
            + 'no assignments. They will appear here as soon as a family member adds you.',
        }}
      >
        <View style={styles.sections}>
          {/* ── today's open visits ── */}
          {openToday.length ? (
            <View>
              <SectionHeading>Today&rsquo;s visits</SectionHeading>
              <Card padded={false}>
                {openToday.map((visit, index) => (
                  <View key={visit.id}>
                    {index > 0 ? <Divider inset={space.lg + 54} /> : null}
                    <Touchable
                      onPress={() => openForVisit(visit)}
                      scale={false}
                      style={styles.visitRow}
                      accessibilityRole="button"
                      accessibilityLabel={
                        `${time(visit.scheduledFor)}, ${visit.recipientName}. ${visit.kind}. `
                        + `${visit.tasks?.length || 0} tasks.`
                      }
                      accessibilityHint="Opens a visit report with this visit's checklist"
                    >
                      <Text style={styles.visitTime}>{time(visit.scheduledFor)}</Text>
                      <View style={styles.visitRule} />
                      <View style={styles.visitBody}>
                        <Text style={styles.visitName} numberOfLines={1}>{visit.recipientName}</Text>
                        <Text style={styles.visitMeta} numberOfLines={1}>
                          {[visit.kind, visit.tasks?.length ? `${visit.tasks.length} tasks` : null]
                            .filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.label} />
                    </Touchable>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}

          {/* ── anyone else ── */}
          <View>
            <SectionHeading>
              {openToday.length ? 'Someone else' : 'Your assignments'}
            </SectionHeading>

            {recipients.length > 4 ? (
              <View style={styles.search}>
                <SearchField
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search by name…"
                  accessibilityLabel="Search your assignments by name"
                  resultCount={query.trim() ? filtered.length : null}
                />
              </View>
            ) : null}

            {filtered.length ? (
              <Card padded={false}>
                {filtered.map((person, index) => {
                  const statusInfo = RECIPIENT_STATUS[person.status] || RECIPIENT_STATUS.stable;
                  return (
                    <View key={person.id}>
                      {index > 0 ? <Divider inset={space.lg + 56} /> : null}
                      <Touchable
                        onPress={() => openForPerson(person)}
                        scale={false}
                        style={styles.personRow}
                        accessibilityRole="button"
                        accessibilityLabel={
                          `${person.fullName}. ${statusInfo.label}. `
                          + `Last visit ${person.lastVisitAt ? dayAndTime(person.lastVisitAt) : 'none yet'}.`
                        }
                        accessibilityHint="Opens a blank visit report for this person"
                      >
                        <Avatar name={person.fullName} size="sm" />
                        <View style={styles.personBody}>
                          <View style={styles.personNameRow}>
                            <Text style={styles.personName} numberOfLines={1}>{person.fullName}</Text>
                            <Chip tone={statusInfo.tone} label={statusInfo.label} compact />
                          </View>
                          <Text style={styles.personMeta} numberOfLines={1}>
                            {person.lastVisitAt
                              ? `Last visit ${dayAndTime(person.lastVisitAt)}`
                              : 'No visits recorded yet'}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.label} />
                      </Touchable>
                    </View>
                  );
                })}
              </Card>
            ) : (
              <Card style={styles.noMatch}>
                <Text style={styles.noMatchText}>
                  {`No match for “${query.trim()}”.`}
                </Text>
                <PillButton
                  label="Clear search"
                  variant="tonal"
                  size="sm"
                  onPress={() => setQuery('')}
                />
              </Card>
            )}
          </View>
        </View>
      </ListState>
    </PortalShell>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },
  search: { marginBottom: space.md },

  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg - 2,
  },
  visitTime: { ...type.bodyMedium, fontSize: 14, color: colors.ink, width: 42 },
  visitRule: { width: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: colors.tealSoft },
  visitBody: { flex: 1, gap: 2 },
  visitName: { ...type.bodyMedium, fontSize: 14, color: colors.ink },
  visitMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted },

  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 64,
  },
  personBody: { flex: 1, gap: 2 },
  personNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  personName: { ...type.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
  personMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted },

  noMatch: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  noMatchText: { ...type.caption, color: colors.inkMuted },
});
