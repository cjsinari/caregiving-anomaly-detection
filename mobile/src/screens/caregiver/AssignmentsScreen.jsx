import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider } from '../../components/oneui/Card';
import Chip, { RECIPIENT_STATUS } from '../../components/oneui/Chip';
import Avatar from '../../components/oneui/Avatar';
import SearchField from '../../components/oneui/SearchField';
import PillButton from '../../components/oneui/PillButton';
import Touchable from '../../components/oneui/Touchable';
import ListState, { ListError } from '../../components/oneui/ListState';
import useAsyncResource from '../../hooks/useAsyncResource';
import { care } from '../../api/caregiver';
import { colors, space, type } from '../../theme/tokens';
import { dayAndTime, isoDay } from '../../utils/datetime';

/*
 * Everyone this caregiver is assigned to: item 2 of issue #44, and the screen
 * acceptance criterion 1 is really about.
 *
 * ── Scoping is not done here ──
 *
 * "Caregivers see only their own assigned recipients" is enforced at the
 * database, by resourceAccess.listAccessibleProfiles -- the query joins
 * through `assignments` and only returns rows for active, in-window
 * assignments. This screen renders whatever it is given. That is deliberate
 * and is worth being explicit about: a filter applied in a React component is
 * a filter that anyone holding the phone can remove, and a screen that filters
 * its own data quietly teaches the next person that filtering client-side is
 * how this codebase does authorization.
 *
 * ── Two different kinds of empty ──
 *
 * No assignments at all, and no match for what was typed. They are different
 * situations with different remedies and they get different screens; see
 * ListState for why conflating them is a bug report waiting to happen.
 */
export default function AssignmentsScreen({ navigation }) {
  const [query, setQuery] = useState('');

  const load = useCallback(() => care.assignments(), []);
  const { status, data, error, isRefreshing, reload } = useAsyncResource(load);

  const recipients = data?.recipients || [];

  /*
   * Name and address, which is what the placeholder promises.
   *
   * Accent-insensitive on purpose: a caregiver typing "Ochieng" should find
   * "Óchieng", and normalising both sides is a line of code against a support
   * call that is impossible to diagnose from the other end of a phone.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!q) return recipients;
    return recipients.filter((person) => {
      const haystack = [person.fullName, person.address, person.reference, ...(person.conditions || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      return haystack.includes(q);
    });
  }, [recipients, query]);

  const searching = Boolean(query.trim());
  const activeCount = data?.active ?? recipients.filter((r) => r.status !== 'inactive').length;
  const totalCount = data?.count ?? recipients.length;

  return (
    <PortalShell
      navigation={navigation}
      active="Assignments"
      barTitle="Assignments"
      title="My Assignments"
      subtitle={
        status === 'loading'
          ? 'Loading your caseload…'
          : `${activeCount} active · ${totalCount} total`
      }
      onRefresh={reload}
      refreshing={isRefreshing}
    >
      {/* Hidden until there is a list worth filtering: a search box above an
          empty screen is furniture. */}
      {recipients.length ? (
        <View style={styles.search}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or address…"
            accessibilityLabel="Search your assignments by name or address"
            resultCount={searching ? filtered.length : null}
          />
        </View>
      ) : null}

      {status === 'error' && data ? (
        <View style={styles.inlineError}>
          <ListError error={error} onRetry={reload} title="Could not refresh" />
        </View>
      ) : null}

      <ListState
        status={status}
        error={error}
        isEmpty={!filtered.length}
        onRetry={reload}
        skeletonRows={3}
        skeletonHeight={158}
        empty={searching ? {
          icon: 'search-outline',
          title: `No match for “${query.trim()}”`,
          body: 'Try part of a name, or a street.',
          /*
           * Not "Clear search": the search box's own × is already called
           * that, and two controls with the same name on one screen is an
           * ambiguity for anyone navigating by name rather than by position.
           * This one also says what it does rather than what it undoes.
           */
          action: (
            <PillButton
              label="Show all assignments"
              variant="tonal"
              size="sm"
              onPress={() => setQuery('')}
            />
          ),
        } : {
          icon: 'people-outline',
          title: 'No assignments yet',
          body: 'A family member adds you to a care team from their own account. '
            + 'Once they do, the people you look after appear here.',
        }}
      >
        <View style={styles.list}>
          {filtered.map((person) => {
            const statusInfo = RECIPIENT_STATUS[person.status] || RECIPIENT_STATUS.stable;

            return (
              <Card
                key={person.id}
                padded={false}
                onPress={() => navigation.navigate('RecipientDetail', { recipientId: person.id })}
                accessibilityLabel={
                  `${person.fullName}. ${statusInfo.label}. `
                  + `${person.age ? `${person.age} years. ` : ''}`
                  + `${(person.conditions || []).join(', ')}. `
                  + `${person.address || ''}`
                }
                accessibilityHint="Opens the care record"
              >
                <View style={styles.cardBody}>
                  <View style={styles.headRow}>
                    <Avatar name={person.fullName} size="md" />

                    <View style={styles.headText}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={1}>{person.fullName}</Text>
                        <Chip tone={statusInfo.tone} label={statusInfo.label} compact />
                      </View>
                      <Text style={styles.meta} numberOfLines={1}>
                        {[person.age ? `${person.age} years` : null, (person.conditions || []).join(' · ')]
                          .filter(Boolean).join(' · ')}
                      </Text>
                      {person.address ? (
                        <View style={styles.addressRow}>
                          <Ionicons name="location-outline" size={13} color={colors.label} />
                          <Text style={styles.address} numberOfLines={2}>{person.address}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/*
                     * The assignment reference, as the mockup shows it. Quiet
                     * on purpose and hidden from assistive tech: it is there
                     * for the one phone call a month where somebody has to
                     * quote it, not for every pass down the list.
                     */}
                    {person.reference ? (
                      <Text style={styles.reference} importantForAccessibility="no">
                        {person.reference}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <Divider inset={space.lg} />

                <View style={styles.footRow}>
                  <View style={styles.stats}>
                    <Stat label="Since" value={isoDay(person.since)} />
                    <Stat label="Visits" value={String(person.visitCount ?? 0)} />
                    <Stat
                      label="Last visit"
                      value={person.lastVisitAt ? dayAndTime(person.lastVisitAt) : 'None yet'}
                    />
                  </View>

                  <PillButton
                    label="File visit report"
                    iconRight="arrow-forward"
                    variant="quiet"
                    size="sm"
                    onPress={() => navigation.navigate('VisitReport', { recipientId: person.id })}
                    accessibilityHint={`Starts a visit report for ${person.fullName}`}
                  />
                </View>
              </Card>
            );
          })}
        </View>
      </ListState>
    </PortalShell>
  );
}

/** One of the three facts on the card's bottom rail. */
function Stat({ label, value }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { marginBottom: space.lg },
  inlineError: { marginBottom: space.lg },
  list: { gap: space.md },

  cardBody: { padding: space.lg },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headText: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  name: { ...type.title, fontSize: 16, lineHeight: 22, color: colors.ink, flexShrink: 1 },
  meta: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs + 1, marginTop: 2 },
  address: { ...type.caption, fontSize: 12, color: colors.label, flex: 1 },
  reference: { ...type.caption, fontSize: 10, color: colors.placeholder, letterSpacing: 0.5 },

  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    flexWrap: 'wrap',
  },
  stats: { flexDirection: 'row', gap: space.lg, flexShrink: 1 },
  stat: { gap: 0 },
  statLabel: { ...type.caption, fontSize: 10, color: colors.placeholder },
  statValue: { ...type.captionMedium, fontSize: 12, color: colors.ink },
});
