import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import ListState, { ListError } from '../../components/oneui/ListState';
import RecipientSwitcher from '../../components/family/RecipientSwitcher';
import FamilyGate from '../../components/family/FamilyGate';
import useAsyncResource from '../../hooks/useAsyncResource';
import { family } from '../../api/family';
import { useFamily } from '../../family/FamilyContext';
import { colors, space, type } from '../../theme/tokens';
import { day, dayOffset, time } from '../../utils/datetime';

/*
 * Upcoming visits: item 5 of issue #45.
 *
 * Grouped by day, because that is how the question is asked -- "is anyone
 * going on Saturday?" -- and a flat list of timestamps makes the reader do the
 * grouping. The day headings use the same relative words as the rest of the
 * app ("Today", "Tomorrow", "Thu"), and a day with no visit simply has no
 * heading rather than an empty one: the gap in the list is the answer.
 *
 * Each visit names the caregiver going, which matters more than it seems. A
 * weekend relief caregiver is a stranger at the door to an 80-year-old, and
 * the family member who can say "Daniel is coming on Saturday, not Grace" on
 * the phone the night before is the reason that visit goes smoothly.
 */
export default function ScheduleScreen({ navigation }) {
  const { selected, displayName } = useFamily();

  return (
    <PortalShell
      navigation={navigation}
      active="Schedule"
      barTitle="Schedule"
      title="Schedule"
      subtitle={selected ? `Upcoming visits to ${displayName(selected)}` : null}
    >
      <FamilyGate>
        {(recipient) => <Visits recipient={recipient} name={displayName(recipient)} />}
      </FamilyGate>
    </PortalShell>
  );
}

function Visits({ recipient, name }) {
  const load = useCallback(() => family.schedule(recipient.id), [recipient.id]);
  const { status, data, error, reload } = useAsyncResource(load, [recipient.id]);
  const visits = data?.visits || [];

  /** [{ key, label, visits }], soonest day first. */
  const days = useMemo(() => {
    const groups = new Map();
    visits.forEach((v) => {
      const offset = dayOffset(v.at);
      if (!groups.has(offset)) {
        groups.set(offset, { key: String(offset), label: day(v.at, { long: true }), visits: [] });
      }
      groups.get(offset).visits.push(v);
    });
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
  }, [visits]);

  return (
    <View>
      <RecipientSwitcher />

      {status === 'error' && data ? (
        <View style={styles.banner}>
          <ListError error={error} onRetry={reload} title="Could not refresh" />
        </View>
      ) : null}

      <ListState
        status={status}
        error={error}
        isEmpty={!visits.length}
        onRetry={reload}
        skeletonRows={3}
        skeletonHeight={90}
        empty={{
          icon: 'calendar-outline',
          title: 'No visits booked',
          body: `Nothing is scheduled for ${name} yet. The care team adds visits as they plan the week.`,
        }}
      >
        <View style={styles.days}>
          {days.map((group) => (
            <View key={group.key}>
              <SectionHeading>{group.label}</SectionHeading>
              <Card padded={false}>
                {group.visits.map((v, i) => (
                  <View key={v.id}>
                    {i > 0 ? <Divider inset={space.lg + 54} /> : null}
                    <View
                      style={styles.row}
                      accessible
                      accessibilityLabel={
                        `${group.label}, ${time(v.at)}. ${v.kind}`
                        + `${v.caregiver ? ` with ${v.caregiver}` : ''}.`
                        + `${v.note ? ` ${v.note}.` : ''}`
                      }
                    >
                      <Text style={styles.time}>{time(v.at)}</Text>
                      <View style={styles.rule} />
                      <View style={styles.body}>
                        <Text style={styles.kind}>{v.kind}</Text>
                        {v.caregiver ? (
                          <View style={styles.metaRow}>
                            <Ionicons name="person-outline" size={12} color={colors.label} />
                            <Text style={styles.meta}>{v.caregiver}</Text>
                          </View>
                        ) : null}
                        {v.note ? (
                          <View style={styles.metaRow}>
                            <Ionicons name="information-circle-outline" size={12} color={colors.info} />
                            <Text style={[styles.meta, { color: colors.info }]}>{v.note}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          ))}
        </View>
      </ListState>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { marginBottom: space.lg },
  days: { gap: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg - 2,
  },
  time: { ...type.bodyMedium, fontSize: 14, color: colors.ink, width: 42 },
  rule: { width: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: colors.tealSoft },
  body: { flex: 1, gap: 2 },
  kind: { ...type.bodyMedium, fontSize: 14, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 1 },
  meta: { ...type.caption, fontSize: 12, color: colors.inkMuted, flex: 1 },
});
