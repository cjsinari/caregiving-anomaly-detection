import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import HeroHeader from '../components/HeroHeader';
import PhoneField from '../components/PhoneField';
import PrimaryButton from '../components/PrimaryButton';
import Banner from '../components/Banner';
import { auth } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { bannerFor } from '../auth/errors';
import {
  loginSchema, loginDefaults, toPhoneNumber, SERVICE_FIELD_TO_FORM_FIELD,
} from '../validation/login';
import { colors, radius, shadow, space, type } from '../theme/tokens';

/*
 * Sign in: the phone number, and nothing else.
 *
 * -- There is no password, and no /auth/login --
 *
 * Authentication is strictly OTP, so signing in is two steps rather than one.
 * This screen asks the service to send a code; the next screen exchanges that
 * code for a session. The mockups show a password field here and it is
 * deliberately not built: the service stores no password, so the field could
 * only mislead someone about how their account is protected.
 *
 * -- Why it always moves on to the code screen --
 *
 * /auth/otp/request answers 200 with the same sentence whether or not the
 * number is registered. That is on purpose: a different answer for a number
 * with no account would turn this screen into a way of discovering who uses
 * the platform -- which, for a service whose users are caregivers and the
 * families of elderly people, is worth protecting. So an unregistered number
 * is told a code is on its way and then finds that none arrives, which is the
 * intended cost of not confirming the guess.
 */
export default function LoginScreen({ navigation }) {
  const { notice, dismissNotice } = useAuth();
  const [banner, setBanner] = useState(null);

  // Guards the request itself rather than the form: isSubmitting flips back as
  // soon as the handler returns, and this has to stay closed until navigation.
  const inFlight = useRef(false);

  const {
    control, handleSubmit, formState: { errors, isSubmitting }, setError, setValue,
  } = useForm({
    /*
     * The schema is built from the values being validated.
     *
     * The rule it changes is real: a +254 number has to be a Kenyan mobile,
     * while a foreign one only has to be plausible. Taking the dial code from
     * `values` rather than from a ref or a `watch` means the schema cannot
     * disagree with what it is checking, and it keeps the dial code out of the
     * render body -- a `watch` there re-renders the whole form on every
     * keystroke in it.
     */
    resolver: (values, context, options) =>
      zodResolver(loginSchema(values.dialCode || '+254'))(values, context, options),
    defaultValues: loginDefaults(),
    mode: 'onTouched',
  });

  // Subscribed on its own, so changing it re-renders the chip and not the form.
  const dialCode = useWatch({ control, name: 'dialCode' }) || '+254';

  const onSubmit = async (values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBanner(null);
    // The sign-out notice has been read by the time someone is typing a number.
    if (notice) dismissNotice();

    const phoneNumber = toPhoneNumber(values);

    try {
      await auth.requestOtp(phoneNumber, 'login');
      navigation.navigate('Verify', { phoneNumber, purpose: 'login' });
    } catch (err) {
      // A field-level 400 means the number itself was refused, so it belongs
      // under the input rather than in a banner at the top of the screen.
      const issues = Array.isArray(err?.details) ? err.details : [];
      let landed = false;
      issues.forEach((issue) => {
        const field = SERVICE_FIELD_TO_FORM_FIELD[issue.field];
        if (field) {
          setError(field, { type: 'server', message: issue.message });
          landed = true;
        }
      });
      if (!landed) setBanner(bannerFor(err));
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <HeroHeader
        brand="LindaCare"
        tagline="Kenya Caregiving Platform"
        title="Welcome back"
        subtitle="Sign in with your registered phone number"
      />

      <View style={styles.body}>
        {/*
          Why the session ended, when it ended by itself. An app that drops
          someone back here with no explanation looks broken, and a session the
          risk engine flagged is something the account owner needs to be told
          about rather than shrug off as a glitch.
        */}
        {notice ? <Banner tone="warning" title="You were signed out">{notice}</Banner> : null}

        {banner ? <Banner tone={banner.tone} title={banner.title}>{banner.message}</Banner> : null}

        <View style={styles.card}>
          <Controller
            control={control}
            name="localNumber"
            render={({ field }) => (
              <PhoneField
                label="Phone number"
                dialCode={dialCode}
                onDialCodeChange={(next) =>
                  setValue('dialCode', next, { shouldValidate: false })}
                // Editable here, unlike the caregiver registration form: a
                // family member who registered from abroad has a foreign
                // number and has to be able to sign in with it.
                editableDialCode
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.localNumber?.message}
              />
            )}
          />

          <Text style={styles.hint}>
            We will send a 6-digit code by SMS. There is no password to remember.
          </Text>

          <PrimaryButton
            label="Send Code"
            loadingLabel={'Sending code…'}
            loading={isSubmitting}
            onPress={handleSubmit(onSubmit)}
            accessibilityHint="Sends a verification code to the number above"
          />

          {/*
            The way out for someone this screen cannot help: no password to
            reset, but a number they can no longer receive a code on. Placed
            under the button rather than beside the field, because it is a
            different intent from signing in and should not be mistaken for a
            hint about the number.
          */}
          <Pressable
            onPress={() => navigation.navigate('Recovery')}
            hitSlop={10}
            style={styles.recover}
            accessibilityRole="link"
            accessibilityLabel="Lost access to this number"
          >
            <Text style={styles.link}>Lost access to this number?</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to LindaCare?</Text>
          <Pressable
            onPress={() => navigation.navigate('Register')}
            hitSlop={10}
            accessibilityRole="link"
            accessibilityLabel="Create a new account"
          >
            <Text style={styles.link}>Create account</Text>
          </Pressable>
        </View>
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
  hint: { ...type.caption, color: colors.inkMuted, marginBottom: space.lg },
  recover: { alignSelf: 'center', paddingVertical: space.md, minHeight: 48, justifyContent: 'center' },
  footer: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.xs,
  },
  footerText: { ...type.body, color: colors.inkMuted },
  link: { ...type.button, color: colors.link },
});
