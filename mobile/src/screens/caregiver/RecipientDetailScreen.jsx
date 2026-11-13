import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import CareNoteSheet from '../../components/caregiver/CareNoteSheet';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import Chip, { RECIPIENT_STATUS } from '../../components/oneui/Chip';
import Avatar from '../../components/oneui/Avatar';
import PillButton from '../../components/oneui/PillButton';
import Touchable from '../../components/oneui/Touchable';
import ListState, { ListEmpty, ListError } from '../../components/oneui/ListState';
import useAsyncResource from '../../hooks/useAsyncResource';
import { care } from '../../api/caregiver';
import { useAuth } from '../../auth/AuthContext';
import { colors, oneui, space, type } from '../../theme/tokens';
import { dayAndTime, isoDay } from '../../utils/datetime';

/*
 * One person's record: item 3 of issue #44 -- profile, medications, care
 * notes, emergency contacts -- and the home of item 6's note and incident
 * form.
 *
 * ── The order of the sections is a clinical decision, not a visual one ──
 *
 * Emergency contacts sit directly under the profile, above the medication
 * list. The mockups do not specify an order and the obvious one is
 * profile → medications → notes → contacts, with contacts last because they
 * are reference material.
 *
 * They are not reference material. The single worst moment this screen will
 * ever be opened in is the one where somebody has fallen and the caregiver
 * needs a phone number in the next ten seconds, and in that moment a contact
 * list below a scrolling medication history might as well not exist. So it
 * goes above the fold, every number is one tap to dial, and the primary
 * contact is marked.
 *
 * Medications come next because "what is she on?" is the second question an
 * ambulance crew asks. Care notes, which are the longest section and the
 * least urgent, come last.
 */
export default function RecipientDetailScreen({ navigation, route }) {
  const { recipientId } = route.params || {};
  const { user } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(() => care.recipient(recipientId), [recipientId]);
  const { status, data, error, isRefreshing, reload } = useAsyncResource(
    load, [recipientId], { enabled: Boolean(recipientId) }
  );

  const person = data;
  const statusInfo = RECIPIENT_STATUS[person?.status] || RECIPIENT_STATUS.stable;

  const addNote = async ({ body, kind }) => {
    await care.addCareNote({
      recipientId,
      body,
      kind,
      author: user?.fullName || 'You',
    });
    // Reload rather than splice the new note in locally: the service decides
    // the note's id and timestamp, and a locally-invented pair that then
    // disagrees with the server is a confusing thing to debug later.
    await reload({ quiet: true });
  };

  const dial = (phone) => {
    const cleaned = String(phone).replace(/[^+\d]/g, '');
    Linking.openURL(`tel:${cleaned}`).catch(() => {
      // A device with no dialler -- a tablet, an emulator. Nothing useful to
      // say, and the number is on screen to be read out either way.
    });
  };

  return (
    <PortalShell
      navigation={navigation}
      active="Assignments"
      barTitle={person?.fullName || 'Care record'}
      title={person?.fullName || 'Care record'}
      subtitle={person ? [
        person.age ? `${person.age} years` : null,
        (person.conditions || []).join(' · '),
      ].filter(Boolean).join(' · ') : 'Loading…'}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Assignments'))}
      onRefresh={reload}
      refreshing={isRefreshing}
      footer={person ? (
        <View style={styles.footerRow}>
          <PillButton
            label="Add note"
            icon="create-outline"
            variant="tonal"
            onPress={() => setSheetOpen(true)}
            style={styles.footerButton}
            accessibilityHint="Write a care note or file an incident report"
          />
          <PillButton
            label="Visit report"
            icon="document-text-outline"
            onPress={() => navigation.navigate('VisitReport', { recipientId })}
            style={styles.footerButton}
            accessibilityHint={`Starts a visit report for ${person.fullName}`}
          />
        </View>
      ) : null}
    >
      <ListState
        status={status}
        error={error}
        isEmpty={!person}
        onRetry={reload}
        skeletonRows={4}
        skeletonHeight={120}
        empty={{
          icon: 'person-outline',
          title: 'Care record unavailable',
          body: 'This person may no longer be on your caseload.',
        }}
      >
        {person ? (
          <View style={styles.sections}>
            {status === 'error' ? (
              <ListError error={error} onRetry={reload} title="Could not refresh" />
            ) : null}

            {/* ── profile ── */}
            <Card style={styles.profileCard}>
              <View style={styles.profileTop}>
                <Avatar name={person.fullName} size="lg" />
                <View style={styles.profileText}>
                  <Text style={styles.profileName}>{person.fullName}</Text>
                  <Chip tone={statusInfo.tone} label={statusInfo.label} />
                </View>
              </View>

              <Divider inset={0} />

              <View style={styles.grid}>
                <GridItem icon="calendar-outline" label="Date of birth" value={isoDay(person.dateOfBirth)} />
                <GridItem icon="home-outline" label="Address" value={person.address} />
                <GridItem icon="time-outline" label="In your care since" value={isoDay(person.since)} />
                <GridItem
                  icon="walk-outline"
                  label="Visits"
                  value={`${person.visitCount ?? 0} · last ${person.lastVisitAt ? dayAndTime(person.lastVisitAt) : 'none'}`}
                />
              </View>
            </Card>

            {/* ── emergency contacts ── */}
            <View>
              <SectionHeading>Emergency Contacts</SectionHeading>
              {(person.emergencyContacts || []).length ? (
                <Card padded={false}>
                  {person.emergencyContacts.map((contact, index) => (
                    <View key={contact.id}>
                      {index > 0 ? <Divider inset={space.lg + 46} /> : null}
                      <Touchable
                        onPress={() => dial(contact.phone)}
                        scale={false}
                        style={styles.contactRow}
                        accessibilityRole="button"
                        accessibilityLabel={
                          `${contact.name}, ${contact.relationship}${contact.isPrimary ? ', primary contact' : ''}. `
                          + `${contact.phone}`
                        }
                        accessibilityHint="Calls this number"
                      >
                        <View style={styles.contactIcon}>
                          <Ionicons
                            name={contact.isPrimary ? 'star' : 'call-outline'}
                            size={16}
                            color={contact.isPrimary ? colors.warning : colors.teal}
                          />
                        </View>
                        <View style={styles.contactBody}>
                          <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
                          <Text style={styles.contactMeta} numberOfLines={1}>
                            {contact.relationship}
                            {contact.isPrimary ? ' · Primary' : ''}
                          </Text>
                        </View>
                        <Text style={styles.contactPhone}>{contact.phone}</Text>
                        <Ionicons name="call" size={16} color={colors.teal} />
                      </Touchable>
                    </View>
                  ))}
                </Card>
              ) : (
                <ListEmpty
                  icon="call-outline"
                  title="No emergency contacts"
                  body="Nobody has been recorded for this person. Ask the family member who set up the profile to add one."
                />
              )}
            </View>

            {/* ── medications ── */}
            <View>
              <SectionHeading>Medications</SectionHeading>
              {(person.medications || []).length ? (
                <Card padded={false}>
                  {person.medications.map((med, index) => (
                    <View key={med.id}>
                      {index > 0 ? <Divider inset={space.lg} /> : null}
                      <View
                        style={styles.medRow}
                        accessible
                        accessibilityLabel={
                          `${med.name}, ${med.dose}. ${med.schedule}.${med.notes ? ` ${med.notes}.` : ''}`
                        }
                      >
                        <View style={styles.medHead}>
                          <Text style={styles.medName}>{med.name}</Text>
                          <View style={styles.dose}>
                            <Text style={styles.doseText}>{med.dose}</Text>
                          </View>
                        </View>
                        <Text style={styles.medSchedule}>{med.schedule}</Text>
                        {med.notes ? (
                          <View style={styles.medNote}>
                            <Ionicons name="information-circle" size={13} color={colors.info} />
                            <Text style={styles.medNoteText}>{med.notes}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </Card>
              ) : (
                <ListEmpty
                  icon="medkit-outline"
                  title="No medications recorded"
                  body="Nothing has been added to this care plan yet."
                />
              )}
            </View>

            {/* ── care notes ── */}
            <View>
              <SectionHeading
                action={(
                  <PillButton
                    label="Add"
                    icon="add"
                    variant="quiet"
                    size="sm"
                    onPress={() => setSheetOpen(true)}
                  />
                )}
              >
                Care Notes
              </SectionHeading>

              {(person.careNotes || []).length ? (
                <View style={styles.notes}>
                  {person.careNotes.map((note) => (
                    <Card key={note.id} style={styles.noteCard}>
                      <View style={styles.noteHead}>
                        <Text style={styles.noteAuthor} numberOfLines={1}>{note.author}</Text>
                        {note.kind === 'incident' ? (
                          <Chip tone="danger" label="Incident" compact />
                        ) : null}
                        <Text style={styles.noteWhen}>{dayAndTime(note.at)}</Text>
                      </View>
                      <Text style={styles.noteBody} selectable>{note.body}</Text>
                    </Card>
                  ))}
                </View>
              ) : (
                <ListEmpty
                  icon="document-text-outline"
                  title="No care notes yet"
                  body="Notes you write after a visit are kept here, newest first."
                  action={(
                    <PillButton
                      label="Write the first note"
                      variant="tonal"
                      size="sm"
                      onPress={() => setSheetOpen(true)}
                    />
                  )}
                />
              )}
            </View>
          </View>
        ) : null}
      </ListState>

      <CareNoteSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={addNote}
        recipientName={person?.fullName}
      />
    </PortalShell>
  );
}

/** One labelled fact in the profile card's two-column grid. */
function GridItem({ icon, label, value }) {
  return (
    <View
      style={styles.gridItem}
      accessible
      accessibilityLabel={`${label}: ${value || 'not recorded'}`}
    >
      <View style={styles.gridLabelRow}>
        <Ionicons name={icon} size={13} color={colors.label} />
        <Text style={styles.gridLabel}>{label}</Text>
      </View>
      <Text style={styles.gridValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },

  profileCard: { gap: space.lg },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  profileText: { flex: 1, gap: space.sm },
  profileName: { ...type.title, color: colors.ink },

  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg, columnGap: space.md },
  gridItem: { flexBasis: '46%', flexGrow: 1, gap: 2 },
  gridLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 1 },
  gridLabel: { ...type.label, fontSize: 10, color: colors.label, textTransform: 'uppercase' },
  gridValue: { ...type.caption, color: colors.ink },

  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 60,
  },
  contactIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactBody: { flex: 1, gap: 1 },
  contactName: { ...type.bodyMedium, fontSize: 14, color: colors.ink },
  contactMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  contactPhone: { ...type.caption, fontSize: 12, color: colors.link },

  medRow: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 3 },
  medHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  medName: { ...type.bodyMedium, fontSize: 14, color: colors.ink, flex: 1 },
  dose: {
    backgroundColor: colors.infoBg,
    borderRadius: oneui.radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 2,
  },
  doseText: { ...type.captionMedium, fontSize: 11, color: colors.info },
  medSchedule: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  medNote: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs + 1, marginTop: 2 },
  medNoteText: { ...type.caption, fontSize: 12, color: colors.info, flex: 1 },

  notes: { gap: space.md },
  noteCard: { gap: space.sm },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  noteAuthor: { ...type.captionMedium, fontSize: 12, color: colors.ink, flexShrink: 1 },
  noteWhen: { ...type.caption, fontSize: 11, color: colors.placeholder, marginLeft: 'auto' },
  noteBody: { ...type.body, fontSize: 14, color: colors.inkMuted },

  footerRow: { flexDirection: 'row', gap: space.md },
  footerButton: { flex: 1 },
});
