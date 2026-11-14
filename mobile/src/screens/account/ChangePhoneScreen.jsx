import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { SectionHeading } from '../../components/oneui/Card';
import PillButton from '../../components/oneui/PillButton';
import PhoneField from '../../components/PhoneField';
import OtpInput from '../../components/OtpInput';
import Banner from '../../components/Banner';
import { account } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { useGoTo } from '../../navigation/routes';
import { cleanDigits, phoneField, toE164 } from '../../validation/phone';
import { colors, space, type } from '../../theme/tokens';

/*
 * Changing the phone number: the credential this account signs in with.
 *
 * ── Two codes, and why the screen says where each one went ──
 *
 * The service sends one code to the number on the account and one to the new
 * number (accountController.js explains why both: the first proves the owner
 * wants this, the second that they hold the new number). Two six-digit codes
 * arriving at once is confusing unless each box says which phone its code is
 * on -- so each is labelled with its number, masked as the service returned
 * it, and a wrong code is reported under the box it belongs to.
 *
 * ── After it succeeds ──
 *
 * Every other device signed in to the account has been signed out by the
 * service, and the screen says so: someone who changed their number because
 * they lost the old phone needs to know that phone is no longer signed in.
 *
 * ── Who may have a foreign number ──
 *
 * A family member may live anywhere, so they choose a dial code. A caregiver
 * works in Kenya and signs in with a Kenyan mobile, as registration requires,
 * so the dial code is fixed at +254.
 */
export default function ChangePhoneScreen({ navigation }) {
  const { user, role, updateUser } = useAuth();
  const goTo = useGoTo(navigation);
  const family = role === 'family';

  const [step, setStep] = useState('enter');          // enter | verify | done
  const [dialCode, setDialCode] = useState('+254');
  const [local, setLocal] = useState('');
  const [phoneError, setPhoneError] = useState(null);
  const [sentTo, setSentTo] = useState(null);         // { currentNumber, newNumber }
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [codeErrors, setCodeErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const e164 = toE164(dialCode, local);
  const back = () => (navigation.canGoBack() ? navigation.goBack() : goTo('Account'));

  const request = async () => {
    setBanner(null);
    const check = phoneField(dialCode).safeParse(local);
    if (!check.success) {
      setPhoneError(check.error.issues[0].message);
      return;
    }
    setPhoneError(null);
    setBusy(true);
    try {
      const sent = await account.requestPhoneChange(e164);
      setSentTo(sent);
      setCurrentCode('');
      setNewCode('');
      setCodeErrors({});
      setStep('verify');
    } catch (err) {
      const detail = (err?.details || []).find((d) => d.field === 'phoneNumber');
      if (err?.code === 'PHONE_IN_USE' || err?.code === 'PHONE_UNCHANGED' || detail) {
        setPhoneError(err.message || detail?.message);
      } else {
        setBanner(err?.message || 'The codes could not be sent. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBanner(null);
    const errors = {};
    if (cleanDigits(currentCode).length !== 6) errors.currentCode = 'Enter the 6-digit code';
    if (cleanDigits(newCode).length !== 6) errors.newCode = 'Enter the 6-digit code';
    setCodeErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      const done = await account.verifyPhoneChange({
        phoneNumber: e164,
        currentCode: cleanDigits(currentCode),
        newCode: cleanDigits(newCode),
      });
      await updateUser({ phoneNumber: done.user?.phoneNumber ?? e164 });
      setResult(done);
      setStep('done');
    } catch (err) {
      if (err?.code === 'OTP_EXHAUSTED') {
        // The code is burnt. Back to the start, saying why, rather than
        // leaving two boxes that can no longer succeed.
        setStep('enter');
        setBanner('Too many incorrect codes. Request new codes to try again.');
      } else {
        const detail = (err?.details || [])[0];
        if (detail?.field === 'currentCode' || detail?.field === 'newCode') {
          const left = err.attemptsLeft != null
            ? ` ${err.attemptsLeft} ${err.attemptsLeft === 1 ? 'try' : 'tries'} left.`
            : '';
          setCodeErrors({ [detail.field]: `${err.message}${left}` });
        } else if (err?.code === 'PHONE_IN_USE') {
          setStep('enter');
          setPhoneError(err.message);
        } else {
          setBanner(err?.message || 'Your number was not changed. Please try again.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PortalShell
      navigation={navigation}
      active="Account"
      barTitle="Change Phone"
      title="Change phone number"
      subtitle={step === 'done' ? 'Done' : 'You sign in with a code sent to this number'}
      onBack={back}
    >
      <View style={styles.sections}>
        {banner ? <Banner tone="error" title="Not changed">{banner}</Banner> : null}

        {step === 'enter' ? (
          <View>
            <SectionHeading>New Number</SectionHeading>
            <Card style={styles.card}>
              <Text style={styles.lead}>
                {`Your number is ${user?.phoneNumber || 'not set'}. We will send a code to it and `}
                another to the new number. You will need both.
              </Text>
              <PhoneField
                label="New phone number"
                dialCode={dialCode}
                onDialCodeChange={setDialCode}
                editableDialCode={family}
                value={local}
                onChangeText={(t) => { setLocal(t); setPhoneError(null); }}
                error={phoneError}
              />
              <PillButton
                label="Send codes"
                icon="chatbubble-ellipses-outline"
                onPress={request}
                loading={busy}
                disabled={!cleanDigits(local)}
                full
              />
              {!cleanDigits(local) ? (
                <Text style={styles.hint}>Enter the new number to continue.</Text>
              ) : null}
            </Card>
          </View>
        ) : null}

        {step === 'verify' ? (
          <View>
            <SectionHeading>Enter Both Codes</SectionHeading>
            <Card style={styles.card}>
              <OtpInput
                label={`Code sent to your current number ${sentTo?.currentNumber || ''}`.trim()}
                value={currentCode}
                onChangeText={(t) => { setCurrentCode(t); setCodeErrors((e) => ({ ...e, currentCode: null })); }}
                error={codeErrors.currentCode}
              />
              <OtpInput
                label={`Code sent to your new number ${sentTo?.newNumber || ''}`.trim()}
                value={newCode}
                onChangeText={(t) => { setNewCode(t); setCodeErrors((e) => ({ ...e, newCode: null })); }}
                error={codeErrors.newCode}
                autoFocus={false}
              />
              <PillButton label="Change number" icon="checkmark" onPress={verify} loading={busy} full />
              <View style={styles.row}>
                <PillButton
                  label="Use a different number"
                  variant="quiet"
                  size="sm"
                  onPress={() => { setStep('enter'); setBanner(null); }}
                />
                <PillButton
                  label="Send new codes"
                  variant="quiet"
                  size="sm"
                  onPress={request}
                  disabled={busy}
                />
              </View>
              <Text style={styles.hint}>
                Did not ask for this? A code arriving on your current number without you starting
                a change means someone else is trying. Do not share it.
              </Text>
            </Card>
          </View>
        ) : null}

        {step === 'done' ? (
          <Card style={[styles.card, styles.done]} accessibilityLiveRegion="polite">
            <View style={styles.doneIcon}>
              <Ionicons name="checkmark-circle" size={32} color={colors.success} />
            </View>
            <Text style={styles.doneTitle} accessibilityRole="header">
              {`Your number is now ${result?.user?.phoneNumber || e164}`}
            </Text>
            <Text style={styles.lead}>
              Sign in with this number from now on.
              {result?.sessionsEnded
                ? ` ${result.sessionsEnded} other ${result.sessionsEnded === 1 ? 'device was' : 'devices were'} signed out.`
                : ' Any other device signed in to your account has been signed out.'}
            </Text>
            <PillButton label="Done" onPress={back} full />
          </Card>
        ) : null}
      </View>
    </PortalShell>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },
  card: { gap: space.md },
  lead: { ...type.body, fontSize: 14, color: colors.ink },
  hint: { ...type.caption, fontSize: 12, color: colors.inkMuted },
  row: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  done: { alignItems: 'center' },
  doneIcon: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
});
