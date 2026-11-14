import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../oneui/Card';
import Avatar from '../oneui/Avatar';
import PillButton from '../oneui/PillButton';
import { colors, space, type } from '../../theme/tokens';
import { isoDay } from '../../utils/datetime';

/*
 * The person looking after your loved one, and the two ways to reach them.
 *
 * Item 4 of issue #45. The point of the whole portal is that a family member
 * should not have to phone anyone to find out how their mother is -- but when
 * they *do* need to, the number should be one tap away rather than in an SMS
 * from three months ago.
 *
 * ── A number the app cannot dial is said, not hidden ──
 *
 * The service masks caregiver numbers in its care-team listing
 * (profileController.listAssignments runs them through maskPhone), so a
 * number may arrive as "+2547****0201". Dialling that dials nothing. Rather
 * than offer two buttons that fail, the card says plainly that the care team
 * has not shared a direct number, and the buttons are not drawn. A disabled
 * Call button with no reason is the kind of thing people tap six times and
 * then report as broken.
 *
 * ── Why Message is SMS ──
 *
 * It is the one channel every phone this app runs on has, and it needs no
 * other app installed or signed in. WhatsApp is how a great deal of Kenya
 * actually messages, and is a reasonable addition -- but it is a choice about
 * the caregiver's personal account that the care team should make, not one the
 * app should make for them by deep-linking into it.
 */

/** A number with any masking in it, or none at all, cannot be dialled. */
export function isDiallable(phone) {
  if (!phone) return false;
  if (/[*•x]/i.test(phone)) return false;
  return phone.replace(/[^\d]/g, '').length >= 9;
}

/** Spaces out: a tel: URL with them in does nothing on some diallers. */
const clean = (phone) => String(phone).replace(/[^+\d]/g, '');

export default function CaregiverCard({ caregiver, compact = false, style }) {
  if (!caregiver) return null;

  const reachable = isDiallable(caregiver.phone);
  const firstName = String(caregiver.fullName || '').split(' ')[0] || 'the caregiver';

  const open = (url) => Linking.openURL(url).catch(() => {
    // No dialler or messaging app -- a tablet, an emulator. The number is on
    // screen to be read out either way.
  });

  return (
    <Card style={[styles.card, style]}>
      <View style={styles.head}>
        <Avatar name={caregiver.fullName} size={compact ? 'md' : 'lg'} tone="teal" />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>{caregiver.fullName}</Text>
          <Text style={styles.role} numberOfLines={1}>{caregiver.role}</Text>
          {caregiver.since && !compact ? (
            <Text style={styles.since}>{`Caring since ${isoDay(caregiver.since)}`}</Text>
          ) : null}
        </View>
        {caregiver.isPrimary ? (
          <View style={styles.primary} accessible accessibilityLabel="Lead caregiver">
            <Ionicons name="star" size={11} color={colors.warning} />
          </View>
        ) : null}
      </View>

      {reachable ? (
        <View style={styles.actions}>
          <PillButton
            label="Call"
            icon="call"
            onPress={() => open(`tel:${clean(caregiver.phone)}`)}
            style={styles.action}
            accessibilityHint={`Calls ${caregiver.fullName} on ${caregiver.phone}`}
          />
          <PillButton
            label="Message"
            icon="chatbubble-ellipses-outline"
            variant="tonal"
            onPress={() => open(`sms:${clean(caregiver.phone)}`)}
            style={styles.action}
            accessibilityHint={`Opens a text message to ${caregiver.fullName}`}
          />
        </View>
      ) : (
        <View style={styles.noNumber} accessible accessibilityRole="text">
          <Ionicons name="information-circle-outline" size={15} color={colors.info} />
          <Text style={styles.noNumberText}>
            {`The care team has not shared a direct number for ${firstName}. `}
            Contact the care agency to reach them.
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, gap: 1 },
  name: { ...type.title, fontSize: 17, lineHeight: 24, color: colors.ink },
  role: { ...type.caption, color: colors.inkMuted },
  since: { ...type.caption, fontSize: 11, color: colors.placeholder },
  primary: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  actions: { flexDirection: 'row', gap: space.md },
  action: { flex: 1 },
  noNumber: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  noNumberText: { ...type.caption, color: colors.info, flex: 1 },
});
