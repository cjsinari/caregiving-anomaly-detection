import { useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import PortalShell from '../../components/caregiver/PortalShell';
import { usePortalChrome } from '../../components/caregiver/PortalChrome';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import Avatar from '../../components/oneui/Avatar';
import PillButton from '../../components/oneui/PillButton';
import Touchable from '../../components/oneui/Touchable';
import { ListError, ListSkeleton } from '../../components/oneui/ListState';
import Banner from '../../components/Banner';
import { useAuth } from '../../auth/AuthContext';
import { useAccount } from '../../account/AccountContext';
import { careApiSource } from '../../api/careSource';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * Account: the profile, notification settings, the app's version, and signing
 * out (#46). One tab in both portals, because everything on it is about the
 * person rather than about care.
 *
 * ── Why notification settings are here and not on the care plan ──
 *
 * #45 put "notify me about" switches on the family care plan. They only
 * filtered the in-app list, because they lived on the phone; a push sender on
 * the service could never have read them. They are here now, saved on the
 * service (AccountContext), and both pushes and the in-app list obey them.
 *
 * ── Sign out asks once, in place ──
 *
 * A confirmation, because sign-out on this app is not cheap to undo: signing
 * back in costs an SMS code, and for a caregiver standing in a client's
 * doorway, a minute. It is drawn in the card rather than as a system dialog,
 * which would block the whole app and read as an error.
 */

const PUSH_COPY = {
  on: 'On for this phone.',
  off: 'Off. You will still see everything in the app.',
  pending: 'Checking this phone…',
  denied: 'Blocked in your phone’s settings. Allow notifications for LindaCare there to turn them on.',
  unsupported: 'Not available on an emulator. Use a real phone to receive notifications.',
  unavailable: 'Could not be set up on this phone just now. Try switching them on again later.',
};

const SOURCE_COPY = {
  live: 'Care service',
  mock: 'Demo data (care service not connected)',
  unresolved: 'Not checked yet',
};

export default function AccountScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { portal } = usePortalChrome();
  const {
    prefs, status, error, saveError, pushStatus, reload, setCategory, setPush,
  } = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const version = Constants.expoConfig?.version || 'unknown';
  const pushOn = prefs?.push !== false && pushStatus === 'on';

  const togglePush = async (on) => {
    setPushBusy(true);
    try { await setPush(on); } finally { setPushBusy(false); }
  };

  const doSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      // No setState after: a successful sign-out unmounts this screen.
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <PortalShell
      navigation={navigation}
      active="Account"
      barTitle="Account"
      title="Account"
      subtitle={portal.roleLabel}
    >
      <View style={styles.sections}>
        {/* ── profile ── */}
        <Card
          onPress={() => navigation.navigate('Profile')}
          accessibilityLabel={`${user?.fullName || 'Your profile'}. ${user?.phoneNumber || ''}`}
          accessibilityHint="Opens your profile, where you can change your name and phone number"
        >
          <View style={styles.profileRow}>
            <Avatar name={user?.fullName} size="lg" tone="teal" />
            <View style={styles.profileText}>
              <Text style={styles.name} numberOfLines={1}>{user?.fullName || 'Your profile'}</Text>
              {user?.phoneNumber ? <Text style={styles.meta}>{user.phoneNumber}</Text> : null}
              <Text style={styles.edit}>Edit profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.label} />
          </View>
        </Card>

        {/* ── notifications ── */}
        <View>
          <SectionHeading>Notifications</SectionHeading>
          {status === 'loading' && !prefs ? (
            <ListSkeleton rows={1} height={180} />
          ) : !prefs ? (
            <ListError error={error} onRetry={reload} title="Could not load your notification settings" />
          ) : (
            <Card style={styles.notifications}>
              {saveError ? <Banner tone="error" title="Not saved">{saveError}</Banner> : null}

              <View style={styles.toggleRow}>
                <View style={styles.toggleText}>
                  <Text style={styles.toggleLabel}>Push notifications</Text>
                  <Text style={styles.toggleHint} accessibilityLiveRegion="polite">
                    {prefs.push === false ? PUSH_COPY.off : PUSH_COPY[pushStatus] || PUSH_COPY.pending}
                  </Text>
                </View>
                <Switch
                  value={pushOn}
                  onValueChange={togglePush}
                  disabled={pushBusy || pushStatus === 'unsupported'}
                  trackColor={{ true: colors.teal, false: colors.fieldBorder }}
                  thumbColor={colors.surface}
                  accessibilityLabel="Push notifications"
                />
              </View>

              {pushStatus === 'denied' ? (
                <PillButton
                  label="Open phone settings"
                  icon="settings-outline"
                  variant="tonal"
                  size="sm"
                  onPress={() => Linking.openSettings().catch(() => {})}
                />
              ) : null}

              <Divider inset={0} />

              <Text style={styles.blockLabel}>NOTIFY ME ABOUT</Text>
              {prefs.categories.map((c) => (
                <View key={c.key} style={styles.toggleRow}>
                  <View style={styles.toggleText}>
                    <Text style={styles.toggleLabel}>{c.label}</Text>
                    <Text style={styles.toggleHint}>{c.hint}</Text>
                  </View>
                  <Switch
                    value={c.enabled}
                    onValueChange={(on) => setCategory(c.key, on)}
                    trackColor={{ true: colors.teal, false: colors.fieldBorder }}
                    thumbColor={colors.surface}
                    accessibilityLabel={c.label}
                    accessibilityHint={c.hint}
                  />
                </View>
              ))}

              <View style={styles.alwaysOn}>
                <Ionicons name="shield-checkmark-outline" size={14} color={colors.success} />
                <Text style={styles.alwaysOnText}>
                  {(prefs.alwaysOn || []).includes('incident')
                    ? 'Incidents and account security alerts always reach you and cannot be switched off.'
                    : 'Account security alerts always reach you and cannot be switched off.'}
                </Text>
              </View>
            </Card>
          )}
        </View>

        {/* ── about ── */}
        <View>
          <SectionHeading>About</SectionHeading>
          <Card padded={false}>
            <InfoRow label="App version" value={version} />
            <Divider inset={space.lg} />
            <InfoRow label="Care data" value={SOURCE_COPY[careApiSource()] || SOURCE_COPY.unresolved} />
          </Card>
        </View>

        {/* ── sign out ── */}
        <Card style={styles.signOut}>
          {confirming ? (
            <View style={styles.confirm} accessibilityLiveRegion="polite">
              <Text style={styles.confirmText}>Sign out of LindaCare on this phone?</Text>
              <Text style={styles.confirmHint}>
                You will need a code sent to your phone to sign back in, and this phone will stop
                receiving your notifications.
              </Text>
              <View style={styles.confirmRow}>
                <PillButton
                  label="Stay signed in"
                  variant="tonal"
                  onPress={() => setConfirming(false)}
                  disabled={signingOut}
                  style={styles.flex}
                />
                <PillButton
                  label="Sign out"
                  variant="danger"
                  onPress={doSignOut}
                  loading={signingOut}
                  style={styles.flex}
                />
              </View>
            </View>
          ) : (
            <Touchable
              onPress={() => setConfirming(true)}
              scale={false}
              style={styles.signOutRow}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              accessibilityHint="Asks before ending your session on this phone"
            >
              <Ionicons name="log-out-outline" size={20} color={colors.danger} />
              <Text style={styles.signOutText}>Sign out</Text>
            </Touchable>
          )}
        </Card>
      </View>
    </PortalShell>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sections: { gap: space.xl },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  profileText: { flex: 1, gap: 2 },
  name: { ...type.title, color: colors.ink },
  meta: { ...type.caption, color: colors.inkMuted },
  edit: { ...type.captionMedium, fontSize: 12, color: colors.link, marginTop: 2 },

  notifications: { gap: space.md },
  blockLabel: { ...type.label, fontSize: 10, color: colors.label },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH_TARGET },
  toggleText: { flex: 1, gap: 1 },
  toggleLabel: { ...type.bodyMedium, fontSize: 14, color: colors.ink },
  toggleHint: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  alwaysOn: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  alwaysOnText: { ...type.caption, fontSize: 11, color: colors.success, flex: 1 },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: TOUCH_TARGET + 4,
  },
  infoLabel: { ...type.body, fontSize: 14, color: colors.ink },
  infoValue: { ...type.caption, color: colors.inkMuted, flexShrink: 1, textAlign: 'right' },

  signOut: { paddingVertical: space.sm },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH_TARGET,
    borderRadius: oneui.radius.control,
  },
  signOutText: { ...type.bodyMedium, color: colors.danger },
  confirm: { gap: space.md, paddingVertical: space.sm },
  confirmText: { ...type.bodyMedium, color: colors.ink },
  confirmHint: { ...type.caption, color: colors.inkMuted },
  confirmRow: { flexDirection: 'row', gap: space.md },
});
