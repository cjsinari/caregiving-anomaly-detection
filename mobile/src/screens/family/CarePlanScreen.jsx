import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import Chip, { RECIPIENT_STATUS } from '../../components/oneui/Chip';
import Avatar from '../../components/oneui/Avatar';
import PillButton from '../../components/oneui/PillButton';
import Touchable from '../../components/oneui/Touchable';
import { ListEmpty, ListError, ListSkeleton } from '../../components/oneui/ListState';
import CaregiverCard, { isDiallable } from '../../components/family/CaregiverCard';
import RecipientSwitcher from '../../components/family/RecipientSwitcher';
import FamilyGate from '../../components/family/FamilyGate';
import useAsyncResource from '../../hooks/useAsyncResource';
import { family } from '../../api/family';
import { useFamily } from '../../family/FamilyContext';
import { goTo } from '../../navigation/routes';
import { FAMILY_PORTAL } from '../../navigation/portals';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';
import { isoDay } from '../../utils/datetime';

/*
 * The loved one's profile and care plan, read-only: item 3 of issue #45, and
 * the home of the caregiver card's fuller form (item 4).
 *
 * ── Read-only is a property of the screen, not a disabled state ──
 *
 * There are no greyed-out inputs here, no pencil icons that do nothing, no
 * "Edit" that leads to a refusal. A disabled field still says "this is a form
 * you are not allowed to fill in", which invites the question of who is, and
 * a support call to ask. Care data is presented as what it is -- the care
 * team's record, which a family member reads -- and the one line at the top
 * says who to talk to if something in it is wrong.
 *
 * ── The one editable section is visibly not the record ──
 *
 * At the foot, on a differently-titled card, are the family member's own
 * settings: what they call their loved one. It is stored on this phone and
 * persists across a relaunch (FamilyContext). Which notifications they want
 * lived here in #45 and moved to the Account screen in #46, where it is saved
 * on the service so pushes obey it too. Keeping these below and apart from the
 * record
 * is what stops "I renamed her to Mum" being mistaken for "I changed her care
 * record".
 */
export default function CarePlanScreen({ navigation }) {
  const { selected, displayName } = useFamily();

  return (
    <PortalShell
      navigation={navigation}
      active="CarePlan"
      barTitle="Care Plan"
      title={selected ? displayName(selected) : 'Care Plan'}
      subtitle={selected ? 'Profile, care plan and care team' : null}
    >
      <FamilyGate skeletonRows={4}>
        {(recipient) => <Plan recipient={recipient} navigation={navigation} />}
      </FamilyGate>
    </PortalShell>
  );
}

function Plan({ recipient, navigation }) {
  const { displayName } = useFamily();
  const load = useCallback(() => family.recipient(recipient.id), [recipient.id]);
  const { status, data, error, reload } = useAsyncResource(load, [recipient.id]);
  const name = displayName(data || recipient);

  if (status === 'loading') return (<><RecipientSwitcher /><ListSkeleton rows={4} height={130} /></>);
  if (!data) {
    return (
      <>
        <RecipientSwitcher />
        <ListError error={error} onRetry={reload} title="Could not load the care plan" />
      </>
    );
  }

  const statusInfo = RECIPIENT_STATUS[data.status] || RECIPIENT_STATUS.stable;
  const plan = data.carePlan || {};

  return (
    <View style={styles.sections}>
      <RecipientSwitcher />

      <View style={styles.readOnly} accessible accessibilityRole="text">
        <Ionicons name="lock-closed-outline" size={14} color={colors.label} />
        <Text style={styles.readOnlyText}>
          This is the care team&rsquo;s record. If something here is wrong, tell the caregiver
          or the care agency and they will update it.
        </Text>
      </View>

      {/* ── profile ── */}
      <Card style={styles.profile}>
        <View style={styles.profileHead}>
          <Avatar name={data.fullName} size="lg" />
          <View style={styles.profileText}>
            <Text style={styles.profileName}>{data.fullName}</Text>
            {data.relationship ? <Text style={styles.profileMeta}>{`Your ${data.relationship.toLowerCase()}`}</Text> : null}
            <Chip tone={statusInfo.tone} label={statusInfo.label} />
          </View>
        </View>
        <Divider inset={0} />
        <View style={styles.grid}>
          <Fact icon="calendar-outline" label="Date of birth" value={isoDay(data.dateOfBirth)} />
          <Fact icon="home-outline" label="Address" value={data.address} />
          <Fact icon="medkit-outline" label="Conditions" value={(data.conditions || []).join(', ')} />
          <Fact icon="time-outline" label="In care since" value={isoDay(data.careStartedOn)} />
        </View>
      </Card>

      {/* ── the plan ── */}
      <View>
        <SectionHeading>Care Plan</SectionHeading>
        <Card style={styles.plan}>
          {plan.summary ? <Text style={styles.planSummary}>{plan.summary}</Text> : null}

          {(plan.goals || []).length ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>GOALS</Text>
              {plan.goals.map((goal) => (
                <View key={goal} style={styles.goal}>
                  <Ionicons name="flag-outline" size={14} color={colors.teal} />
                  <Text style={styles.goalText}>{goal}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {(plan.routine || []).length ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>ON EACH VISIT</Text>
              {plan.routine.map((item) => (
                <View key={item.id} style={styles.routine}>
                  <Text style={styles.routineLabel}>{item.label}</Text>
                  <Text style={styles.routineFreq}>{item.frequency}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {plan.dietary ? <Note icon="restaurant-outline" label="Diet" text={plan.dietary} /> : null}
          {plan.mobility ? <Note icon="walk-outline" label="Mobility" text={plan.mobility} /> : null}

          {plan.reviewedOn ? (
            <Text style={styles.reviewed}>{`Last reviewed ${isoDay(plan.reviewedOn)}`}</Text>
          ) : null}
        </Card>
      </View>

      {/* ── medications ── */}
      <View>
        <SectionHeading>Medications</SectionHeading>
        {(plan.medications || []).length ? (
          <Card padded={false}>
            {plan.medications.map((med, i) => (
              <View key={med.id}>
                {i > 0 ? <Divider inset={space.lg} /> : null}
                <View
                  style={styles.med}
                  accessible
                  accessibilityLabel={`${med.name}, ${med.dose}. ${med.schedule}.`}
                >
                  <View style={styles.medHead}>
                    <Text style={styles.medName}>{med.name}</Text>
                    <View style={styles.dose}><Text style={styles.doseText}>{med.dose}</Text></View>
                  </View>
                  <Text style={styles.medSchedule}>{med.schedule}</Text>
                </View>
              </View>
            ))}
          </Card>
        ) : (
          <ListEmpty icon="medkit-outline" title="No medications recorded" />
        )}
      </View>

      {/* ── care team ── */}
      <View>
        <SectionHeading>Care Team</SectionHeading>
        {(data.caregivers || []).length ? (
          <View style={styles.stack}>
            {data.caregivers.map((cg) => <CaregiverCard key={cg.id} caregiver={cg} />)}
          </View>
        ) : (
          <ListEmpty
            icon="people-outline"
            title="No caregiver assigned yet"
            body={`Once a caregiver is assigned to ${name}, you will be able to call or message them from here.`}
          />
        )}
      </View>

      {/* ── emergency contacts ── */}
      {(data.emergencyContacts || []).length ? (
        <View>
          <SectionHeading>Emergency Contacts</SectionHeading>
          <Card padded={false}>
            {data.emergencyContacts.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Divider inset={space.lg} /> : null}
                <Touchable
                  onPress={isDiallable(c.phone)
                    ? () => Linking.openURL(`tel:${String(c.phone).replace(/[^+\d]/g, '')}`).catch(() => {})
                    : undefined}
                  disabled={!isDiallable(c.phone)}
                  scale={false}
                  style={styles.contact}
                  accessibilityRole={isDiallable(c.phone) ? 'button' : 'text'}
                  accessibilityLabel={`${c.name}, ${c.relationship}${c.isPrimary ? ', primary contact' : ''}. ${c.phone}`}
                  accessibilityHint={isDiallable(c.phone) ? 'Calls this number' : undefined}
                >
                  <View style={styles.contactBody}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactMeta}>{`${c.relationship}${c.isPrimary ? ' · Primary' : ''}`}</Text>
                  </View>
                  <Text style={styles.contactPhone}>{c.phone}</Text>
                </Touchable>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <YourSettings recipient={data} navigation={navigation} />
    </View>
  );
}

/*
 * The family member's own settings -- the only editable thing in the portal.
 */
function YourSettings({ recipient, navigation }) {
  const { prefs, setNickname, saveError, prefsReady } = useFamily();
  const stored = prefs.nicknames[recipient.id] || '';
  const [draft, setDraft] = useState(stored);
  const [saved, setSaved] = useState(false);

  // When the stored value arrives from the keychain after the first render,
  // or changes because another loved one was selected, the field follows it.
  useEffect(() => { setDraft(stored); }, [stored, recipient.id]);

  const dirty = draft.trim() !== stored;

  const save = () => {
    setNickname(recipient.id, draft);
    setSaved(true);
  };

  return (
    <View>
      <SectionHeading>Your Settings</SectionHeading>
      <Card style={styles.settings}>
        <Text style={styles.settingsNote}>
          These are yours. They change how this app speaks to you, are kept on this phone, and are
          not shared with the care team.
        </Text>

        <View style={styles.block}>
          <Text style={styles.blockLabel}>WHAT YOU CALL THEM</Text>
          <TextInput
            value={draft}
            onChangeText={(t) => { setDraft(t.slice(0, 40)); setSaved(false); }}
            placeholder={recipient.fullName}
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            editable={prefsReady}
            returnKeyType="done"
            onSubmitEditing={dirty ? save : undefined}
            accessibilityLabel={`What you call ${recipient.fullName}`}
            accessibilityHint="Used on every screen of this app instead of their full name. Leave empty to use their name."
          />
          <View style={styles.inputFoot}>
            <Text style={styles.inputHint} accessibilityLiveRegion="polite">
              {saved && !dirty ? 'Saved.' : 'For example Mum, Dad or Shosho.'}
            </Text>
            <PillButton
              label="Save"
              size="sm"
              variant="tonal"
              onPress={save}
              disabled={!dirty}
              accessibilityHint="Saves the name on this phone"
            />
          </View>
        </View>

        <Divider inset={0} />

        <PillButton
          label="Notification settings"
          icon="notifications-outline"
          iconRight="arrow-forward"
          variant="quiet"
          size="sm"
          onPress={() => goTo(navigation, FAMILY_PORTAL, 'Account')}
          accessibilityHint="Opens Account, where you choose which notifications you receive"
        />

        {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
      </Card>
    </View>
  );
}

function Fact({ icon, label, value }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value || 'not recorded'}`}>
      <View style={styles.factLabelRow}>
        <Ionicons name={icon} size={13} color={colors.label} />
        <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      </View>
      <Text style={styles.factValue}>{value || '—'}</Text>
    </View>
  );
}

function Note({ icon, label, text }) {
  return (
    <View style={styles.note}>
      <Ionicons name={icon} size={15} color={colors.label} />
      <Text style={styles.noteText}>
        <Text style={styles.noteLabel}>{`${label}: `}</Text>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },
  stack: { gap: space.md },

  readOnly: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  readOnlyText: { ...type.caption, fontSize: 12, color: colors.inkMuted, flex: 1 },

  profile: { gap: space.lg },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  profileText: { flex: 1, gap: space.xs },
  profileName: { ...type.title, color: colors.ink },
  profileMeta: { ...type.caption, color: colors.inkMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg, columnGap: space.md },
  fact: { flexBasis: '46%', flexGrow: 1, gap: 2 },
  factLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 1 },
  factLabel: { ...type.label, fontSize: 10, color: colors.label },
  factValue: { ...type.caption, color: colors.ink },

  plan: { gap: space.lg },
  planSummary: { ...type.body, color: colors.ink },
  block: { gap: space.sm },
  blockLabel: { ...type.label, fontSize: 10, color: colors.label },
  goal: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  goalText: { ...type.caption, color: colors.ink, flex: 1 },
  routine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.xs,
  },
  routineLabel: { ...type.caption, color: colors.ink },
  routineFreq: { ...type.caption, color: colors.inkMuted },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  noteText: { ...type.caption, color: colors.ink, flex: 1 },
  noteLabel: { fontFamily: type.captionMedium.fontFamily },
  reviewed: { ...type.caption, fontSize: 11, color: colors.placeholder },

  med: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 3 },
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

  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 60,
  },
  contactBody: { flex: 1, gap: 1 },
  contactName: { ...type.bodyMedium, fontSize: 14, color: colors.ink },
  contactMeta: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  contactPhone: { ...type.caption, fontSize: 12, color: colors.link },

  settings: { gap: space.lg, borderWidth: 1.5, borderColor: colors.tealSoft },
  settingsNote: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: oneui.radius.control,
    backgroundColor: colors.field,
    paddingHorizontal: space.lg,
    ...type.body,
    color: colors.ink,
  },
  inputFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  inputHint: { ...type.caption, fontSize: 12, color: colors.inkMuted, flex: 1 },
  saveError: { ...type.caption, fontSize: 12, color: colors.warning },
});
