import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import HeroHeader from '../components/HeroHeader';
import OtpInput from '../components/OtpInput';
import PrimaryButton from '../components/PrimaryButton';
import Banner from '../components/Banner';
import { auth } from '../api/endpoints';
import { getDeviceFingerprint } from '../auth/session';
import { useAuth } from '../auth/AuthContext';
import { bannerFor, otpFieldError } from '../auth/errors';
import { verifySchema, verifyDefaults } from '../validation/login';
import { colors, radius, shadow, space, type } from '../theme/tokens';

/** How long before another code can be requested. */
const RESEND_SECONDS = 30;

/*
 * The code screen: the second half of both signing in and registering.
 *
 * One screen rather than two, because the two differ only in which endpoint
 * the code is posted to -- /auth/login/verify or /auth/register/verify -- and
 * both answer with a session. `route.params.purpose` picks between them.
 *
 * -- Step-up --
 *
 * A sign-in can come back with `status: 'step_up_required'` instead of tokens.
 * That is the risk engine declining to trust the attempt: an unrecognised
 * device, or a sign-in from somewhere the account could not plausibly have
 * reached. A second code is sent and answered through /auth/step-up/verify,
 * which is a different endpoint with a challenge id rather than a phone
 * number. The screen stays where it is and changes what it is asking for,
 * because pushing a second, near-identical screen for the second code would
 * leave the first one behind the back gesture, holding a code that is spent.
 *
 * Handling this is not optional: without it, every sign-in the model is
 * unsure about ends on a screen that waits forever for tokens that are not
 * coming.
 */
export default function VerifyScreen({ route, navigation }) {
  const { phoneNumber, purpose = 'registration', fullName } = route.params || {};
  const { signIn } = useAuth();

  const [banner, setBanner] = useState(null);
  const [challenge, setChallenge] = useState(null);
  // Set when the account locks. The code input stops accepting attempts that
  // the service will refuse anyway, so the lockout does not look like five
  // more wrong answers.
  const [locked, setLocked] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);

  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const {
    control, handleSubmit, formState: { errors, isSubmitting }, setError, reset,
  } = useForm({
    resolver: zodResolver(verifySchema),
    defaultValues: verifyDefaults(),
    mode: 'onSubmit',
  });

  /*
   * The resend countdown.
   *
   * Starts at 30 because a code was sent by the screen that navigated here. It
   * exists to protect the person as much as the service: every request burns
   * one of a 15-minute budget of codes, and tapping resend three times while
   * the first SMS is in transit is the quickest way to a 429 that blocks the
   * sign-in for a quarter of an hour.
   */
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /** Both success paths end the same way: tokens in, app stack out. */
  const completeSignIn = useCallback(async (payload) => {
    /*
     * No navigation call here, deliberately.
     *
     * Signing in swaps the whole navigator from the auth stack to the app
     * stack, so this screen is unmounted rather than covered. That is what
     * makes a back gesture out of the app impossible: there is no history to
     * go back into, because the auth screens are no longer mounted.
     */
    await signIn(payload);
  }, [signIn]);

  const handleFailure = (err) => {
    const fieldMessage = otpFieldError(err);
    if (fieldMessage) {
      setError('otp', { type: 'server', message: fieldMessage });
      return;
    }
    if (err?.code === 'ACCOUNT_LOCKED') setLocked(true);
    if (err?.code === 'CHALLENGE_EXPIRED') setChallenge(null);
    setBanner(bannerFor(err));
  };

  const onSubmit = async (values) => {
    if (inFlight.current || locked) return;
    inFlight.current = true;
    setBanner(null);

    try {
      const deviceFingerprint = await getDeviceFingerprint();

      if (challenge) {
        const payload = await auth.verifyStepUp({
          challengeId: challenge.challengeId,
          otp: values.otp,
          deviceFingerprint,
          // Trusting the device is what makes the challenge a one-off. Without
          // it the same person on the same phone is challenged every time,
          // which trains them to expect it and defeats the point of asking.
          trustDevice: true,
        });
        await completeSignIn(payload);
        return;
      }

      const verify = purpose === 'login' ? auth.verifyLogin : auth.verifyRegistration;
      const payload = await verify({ phoneNumber, otp: values.otp, deviceFingerprint });

      if (payload?.status === 'step_up_required') {
        setChallenge({ challengeId: payload.challengeId, channel: payload.channel });
        setBanner({
          tone: 'warning',
          title: 'One more check',
          message: payload.message || 'For your security we need to verify this sign-in.',
        });
        reset(verifyDefaults());
        setCooldown(RESEND_SECONDS);
        return;
      }

      await completeSignIn(payload);
    } catch (err) {
      if (alive.current) handleFailure(err);
    } finally {
      inFlight.current = false;
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || resending || locked) return;
    setResending(true);
    setBanner(null);
    try {
      /*
       * A step-up challenge cannot be resent: the service issues it as part of
       * a sign-in and /auth/otp/request knows nothing about the challenge id.
       * The honest option is to start again, which also gets a fresh risk
       * evaluation rather than retrying against a stale one.
       */
      if (challenge) {
        setBanner({
          tone: 'info',
          title: 'Start again to get a new code',
          message: 'This security check cannot be resent. Go back and sign in again.',
        });
        return;
      }
      await auth.requestOtp(phoneNumber, purpose);
      setCooldown(RESEND_SECONDS);
      reset(verifyDefaults());
      setBanner({ tone: 'success', title: 'Code sent', message: `A new code is on its way to ${phoneNumber}.` });
    } catch (err) {
      if (err?.code === 'ACCOUNT_LOCKED') setLocked(true);
      setBanner(bannerFor(err));
    } finally {
      if (alive.current) setResending(false);
    }
  };

  const title = challenge ? 'Security check' : 'Verify Phone';
  const subtitle = challenge
    ? 'Enter the second code we just sent you'
    : `Enter the 6-digit code sent to ${phoneNumber || 'your phone'}`;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <HeroHeader
        icon={challenge ? 'shield-checkmark-outline' : 'phone-portrait-outline'}
        title={title}
        subtitle={subtitle}
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />

      <View style={styles.body}>
        {banner ? <Banner tone={banner.tone} title={banner.title}>{banner.message}</Banner> : null}

        {purpose === 'registration' && fullName && !challenge ? (
          <Banner tone="info" title="Almost there">
            {`Thanks, ${fullName.split(' ')[0]}. Enter the code to finish setting up your account.`}
          </Banner>
        ) : null}

        <View style={styles.card}>
          <Controller
            control={control}
            name="otp"
            render={({ field }) => (
              <OtpInput
                label={challenge ? 'Security code' : 'Verification code'}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.otp?.message}
                editable={!locked}
                // Refocused on a fresh challenge, so the second code does not
                // need a tap to enter.
                autoFocus={!locked}
              />
            )}
          />

          <PrimaryButton
            label={challenge ? 'Confirm & Sign In' : 'Verify'}
            loadingLabel={'Checking code…'}
            loading={isSubmitting}
            disabled={locked}
            onPress={handleSubmit(onSubmit)}
          />

          {/*
            The resend control doubles as the explanation for the wait, so the
            countdown is the label rather than a separate line of text. A
            disabled button on its own would be the dead end this avoids.
          */}
          <Pressable
            onPress={onResend}
            disabled={cooldown > 0 || resending || locked}
            hitSlop={8}
            style={styles.resend}
            accessibilityRole="button"
            accessibilityState={{ disabled: cooldown > 0 || resending || locked, busy: resending }}
            accessibilityLabel={
              cooldown > 0 ? `Resend code, available in ${cooldown} seconds` : 'Resend code'
            }
          >
            <Text style={[styles.resendText, (cooldown > 0 || locked) && styles.resendMuted]}>
              {resending
                ? 'Sending…'
                : cooldown > 0
                  ? `Resend code in ${cooldown}s`
                  : 'Resend code'}
            </Text>
          </Pressable>
        </View>

        {locked ? (
          <Pressable
            onPress={() => navigation.navigate('Login')}
            hitSlop={10}
            accessibilityRole="link"
            accessibilityLabel="Back to sign in"
          >
            <Text style={styles.link}>Back to sign in</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.navy },
  scroll: { backgroundColor: colors.page, flexGrow: 1, paddingBottom: space.xxxl },
  body: { paddingHorizontal: space.xl, marginTop: -space.xl, gap: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    ...shadow.card,
  },
  resend: { alignSelf: 'center', paddingVertical: space.md, minHeight: 48, justifyContent: 'center' },
  resendText: { ...type.button, color: colors.link },
  resendMuted: { color: colors.inkMuted },
  link: { ...type.button, color: colors.link, textAlign: 'center' },
});
