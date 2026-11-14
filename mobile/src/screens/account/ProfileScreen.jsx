import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import PillButton from '../../components/oneui/PillButton';
import TextField from '../../components/TextField';
import Banner from '../../components/Banner';
import { account } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { useGoTo } from '../../navigation/routes';
import { colors, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * The person's own profile: view and edit their name and phone number (#46).
 *
 * ── The name saves to the service, and the session remembers it ──
 *
 * "Edits persist after a relaunch" is satisfied twice over: the service has
 * it (PATCH /auth/me), and AuthContext.updateUser writes it into the stored
 * session, so a relaunch with no signal greets them by the new name too
 * rather than by the one they just corrected.
 *
 * ── The phone number is not a text field ──
 *
 * It is how this account signs in. Changing it is its own screen with two
 * codes (ChangePhoneScreen), and it is shown here as a fact with a button
 * rather than as an editable field that would quietly need two SMS codes
 * before its Save button meant anything.
 *
 * ── There is no password section ──
 *
 * The issue mentions a password-change screen. This app has no password to
 * change: sign-in is by SMS code and recovery by a second contact. A
 * "Change password" button here would lead nowhere, or worse, imply a
 * password existed. The section that does the job a password page does on
 * other apps -- changing the credential -- is "Phone number", below.
 */
const NAME_MIN = 2;
const NAME_MAX = 100;

function validateName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'Enter your name';
  if (trimmed.length < NAME_MIN) return 'Enter your full name';
  if (trimmed.length > NAME_MAX) return `Keep it under ${NAME_MAX} characters`;
  return null;
}

export default function ProfileScreen({ navigation }) {
  const { user, updateUser } = useAuth();
  const goTo = useGoTo(navigation);
  const [name, setName] = useState(user?.fullName || '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [fieldError, setFieldError] = useState(null);

  // Follows the stored name if it changes underneath -- a restore landing
  // after first render, say -- as long as the person is not mid-edit.
  useEffect(() => {
    if (!touched) setName(user?.fullName || '');
  }, [user?.fullName, touched]);

  const localError = touched ? validateName(name) : null;
  const dirty = name.trim() !== (user?.fullName || '');
  const canSave = dirty && !validateName(name) && !saving;

  const save = async () => {
    setTouched(true);
    if (!canSave) return;
    setSaving(true);
    setServerError(null);
    setFieldError(null);
    setSaved(false);
    try {
      const { user: fresh } = await account.updateProfile({ fullName: name.trim() });
      await updateUser({ fullName: fresh?.fullName ?? name.trim() });
      setSaved(true);
      setTouched(false);
    } catch (err) {
      const detail = (err?.details || []).find((d) => d.field === 'fullName');
      if (detail) setFieldError(detail.message);
      else setServerError(err?.message || 'Your name was not saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalShell
      navigation={navigation}
      active="Account"
      barTitle="Profile"
      title="Profile"
      subtitle="How LindaCare knows you"
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : goTo('Account'))}
    >
      <View style={styles.sections}>
        {serverError ? <Banner tone="error" title="Not saved">{serverError}</Banner> : null}

        {/* ── name ── */}
        <View>
          <SectionHeading>Your Name</SectionHeading>
          <Card style={styles.card}>
            <TextField
              label="Full name"
              value={name}
              onChangeText={(t) => { setName(t.slice(0, NAME_MAX + 1)); setTouched(true); setSaved(false); setFieldError(null); }}
              onBlur={() => setTouched(true)}
              error={fieldError || localError}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              onSubmitEditing={save}
            />
            <View style={styles.saveRow}>
              <Text style={styles.saveNote} accessibilityLiveRegion="polite">
                {saved
                  ? 'Saved. Your care team will see this name.'
                  : 'The name your care team and family members see.'}
              </Text>
              <PillButton
                label="Save"
                size="sm"
                onPress={save}
                loading={saving}
                disabled={!canSave}
                accessibilityHint="Saves your name"
              />
            </View>
          </Card>
        </View>

        {/* ── phone number ── */}
        <View>
          <SectionHeading>Phone Number</SectionHeading>
          <Card style={styles.card}>
            <View style={styles.phoneRow} accessible accessibilityLabel={`Phone number: ${user?.phoneNumber || 'not set'}`}>
              <View style={styles.phoneIcon}>
                <Ionicons name="phone-portrait-outline" size={18} color={colors.teal} />
              </View>
              <View style={styles.phoneText}>
                <Text style={styles.phone}>{user?.phoneNumber || '—'}</Text>
                <Text style={styles.phoneHint}>You sign in with a code sent to this number.</Text>
              </View>
            </View>
            <Divider inset={0} />
            <PillButton
              label="Change phone number"
              icon="swap-horizontal"
              variant="tonal"
              full
              onPress={() => navigation.navigate('ChangePhone')}
              accessibilityHint="Changing it needs a code sent to your current number and one to the new number"
            />
          </Card>
        </View>

        {/* ── email, for reference ── */}
        {user?.email || user?.backupEmail ? (
          <View>
            <SectionHeading>Email</SectionHeading>
            <Card style={styles.card}>
              {user.email ? <Fact label="Email" value={user.email} /> : null}
              {user.backupEmail ? <Fact label="Recovery email" value={user.backupEmail} /> : null}
              <Text style={styles.phoneHint}>
                Used to recover your account if you lose your phone. Contact support to change it.
              </Text>
            </Card>
          </View>
        ) : null}
      </View>
    </PortalShell>
  );
}

function Fact({ label, value }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },
  card: { gap: space.md },
  saveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginTop: -space.sm },
  saveNote: { ...type.caption, fontSize: 12, color: colors.inkMuted, flex: 1 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH_TARGET },
  phoneIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneText: { flex: 1, gap: 2 },
  phone: { ...type.bodyMedium, color: colors.ink, letterSpacing: 0.3 },
  phoneHint: { ...type.caption, fontSize: 12, color: colors.inkMuted },

  fact: { gap: 2 },
  factLabel: { ...type.label, fontSize: 10, color: colors.label },
  factValue: { ...type.body, fontSize: 14, color: colors.ink },
});
