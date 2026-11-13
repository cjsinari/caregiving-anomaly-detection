import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import HeroHeader from '../components/HeroHeader';
import RoleToggle from '../components/RoleToggle';
import TextField from '../components/TextField';
import PhoneField from '../components/PhoneField';
import SelectField from '../components/SelectField';
import Checkbox from '../components/Checkbox';
import Banner from '../components/Banner';
import PrimaryButton from '../components/PrimaryButton';

import { auth } from '../api/endpoints';
import { ApiError } from '../api/client';
import { KENYA_COUNTIES, COUNTRIES, RELATIONSHIPS, dialCodeFor } from '../data/locality';
import {
  schemaFor, defaultValues, toRegisterPayload, SERVICE_FIELD_TO_FORM_FIELD,
} from '../validation/register';
import { cleanDigits } from '../validation/phone';
import { colors, radius, shadow, space, type } from '../theme/tokens';

/*
 * Create account: the registration form for both roles. Issue #41.
 *
 * One screen, two shapes. The role toggle at the top is the role selection --
 * see the note in RoleToggle.jsx for why it is not a separate screen.
 *
 * ── What the service is actually told ──
 *
 * POST /auth/register creates a *pending* user and texts a six-digit code. It
 * returns a message, not a session: nothing about this account works until
 * that code is entered, which is the screen issue #43 builds. So "success"
 * here means the code was sent, and the only correct thing to do with it is
 * move on to the verification screen.
 *
 * There is no password field, on this screen or anywhere else, because the
 * service has no passwords -- registration and sign-in are both OTP. The
 * mockups show one; it was cut deliberately rather than overlooked, because
 * shipping a field whose value is discarded would be a lie about how the
 * account is secured.
 */

const ROLE_OPTIONS = [
  { value: 'caregiver', label: 'Caregiver', hint: 'Register as someone who provides care' },
  { value: 'family', label: 'Family Member', hint: 'Register to follow a relative’s care' },
];

const COUNTY_OPTIONS = KENYA_COUNTIES.map((c) => ({ value: c, label: c }));
const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
const RELATIONSHIP_OPTIONS = RELATIONSHIPS.map((r) => ({ value: r.value, label: r.label }));

/*
 * The fields worth carrying across a change of role.
 *
 * Someone who fills in their name and number, then realises they picked the
 * wrong role, should not be made to type them again -- that is the moment a
 * registration gets abandoned. Everything else is role-specific and is reset,
 * because a caregiver's county is not a family member's county and a stale
 * value that happens to validate is worse than an empty one.
 */
const CARRIED_ACROSS_ROLES = ['fullName', 'localNumber', 'email'];

export default function RegisterScreen({ navigation }) {
  const [role, setRole] = useState('caregiver');
  const [submitError, setSubmitError] = useState(null);

  // Guards the window between the tap and React Hook Form setting isSubmitting,
  // during which a second tap would otherwise start a second registration --
  // which, on this endpoint, means a second SMS and a consumed rate limit.
  const inFlight = useRef(false);

  // Watched before the form exists would be circular, so these are read from
  // a ref the resolver closes over. The resolver is rebuilt on every render
  // anyway, which is what lets a change of dial code or country revalidate
  // against the right rules on the very next keystroke.
  const shape = useRef({ role: 'caregiver', dialCode: '+254', countryCode: 'KE' });

  const {
    control, handleSubmit, formState: { errors, isSubmitting }, setError, reset, watch, setValue,
    getValues,
  } = useForm({
    resolver: (values, context, options) =>
      zodResolver(schemaFor(shape.current))(values, context, options),
    defaultValues: defaultValues('caregiver'),
    // Validate once a field has been left, then live. Validating on every
    // keystroke from the first character tells someone their half-typed name
    // is too short, which is true and useless.
    mode: 'onTouched',
  });

  const countryCode = watch('countryCode');
  const dialCode = watch('dialCode');

  // Kept in step before the resolver can next run.
  shape.current = { role, dialCode: dialCode || '+254', countryCode: countryCode || 'KE' };

  /*
   * Switching role rebuilds the form under a different schema.
   *
   * `reset` rather than mutating fields, because the two roles have different
   * field sets: leaving a caregiver's nationalId in state while the family
   * schema is active would quietly send it on the next submit.
   */
  const switchRole = useCallback((next) => {
    const current = getValues();
    const carried = Object.fromEntries(
      CARRIED_ACROSS_ROLES.map((key) => [key, current[key]])
    );
    setRole(next);
    setSubmitError(null);
    reset({ ...defaultValues(next), ...carried });
  }, [getValues, reset]);

  /*
   * Moving country reseeds the dialling code, but only while the person has
   * not chosen one themselves.
   *
   * Living abroad and keeping a Kenyan number is ordinary, so the code is not
   * slaved to the country. Defaulting it is a convenience; overriding a
   * deliberate choice would be a bug.
   */
  const dialTouched = useRef(false);
  useEffect(() => {
    if (role !== 'family' || dialTouched.current || !countryCode) return;
    const next = dialCodeFor(countryCode);
    if (next !== dialCode) setValue('dialCode', next, { shouldValidate: false });
  }, [countryCode, dialCode, role, setValue]);

  /*
   * Turn a refusal from the service into something on the screen.
   *
   * Field-level problems go under their field; everything else goes in the
   * banner above the button. The mapping exists because the service names its
   * own fields and one of them -- phoneNumber -- has no input to land on.
   */
  const applyServiceError = useCallback((err) => {
    if (!(err instanceof ApiError)) {
      setSubmitError({ tone: 'error', text: 'Something went wrong. Please try again.' });
      return;
    }

    if (Array.isArray(err.details) && err.details.length) {
      let placed = 0;
      err.details.forEach(({ field, message }) => {
        const target = SERVICE_FIELD_TO_FORM_FIELD[field];
        if (target) { setError(target, { type: 'server', message }); placed += 1; }
      });
      // A 400 whose fields this form does not have is still a refusal someone
      // has to be told about, rather than a submit that silently did nothing.
      if (placed) return;
    }

    switch (err.code) {
      case 'ALREADY_REGISTERED':
        setError('localNumber', { type: 'server', message: 'This number already has an account' });
        setSubmitError({ tone: 'error', text: err.message, showSignIn: true });
        return;
      case 'EMAIL_IN_USE':
        setError('email', { type: 'server', message: 'That email address is already in use' });
        return;
      case 'NATIONAL_ID_IN_USE':
        setError('nationalId', { type: 'server', message: 'This ID is already registered' });
        setSubmitError({ tone: 'error', text: err.message });
        return;
      case 'OTP_RATE_LIMITED':
      case 'ACCOUNT_LOCKED':
        setSubmitError({ tone: 'warning', text: err.message });
        return;
      case 'OTP_DELIVERY_FAILED':
        setSubmitError({ tone: 'warning', text: err.message });
        return;
      default:
        setSubmitError({
          tone: err.isNetwork ? 'warning' : 'error',
          text: err.message,
        });
    }
  }, [setError]);

  const onSubmit = async (values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitError(null);

    const payload = toRegisterPayload(values);
    try {
      await auth.register(payload);
      // The account is pending until the code is entered, so the phone number
      // travels to the next screen -- it is what the verify call is keyed on,
      // and re-deriving it there from form state nobody kept would be fragile.
      navigation.navigate('Verify', {
        phoneNumber: payload.phoneNumber,
        role: payload.role,
        fullName: payload.fullName,
        // The verification screen serves both registration and sign-in; the
        // purpose is what picks the endpoint the code is posted to.
        purpose: 'registration',
      });
    } catch (err) {
      applyServiceError(err);
    } finally {
      inFlight.current = false;
    }
  };

  const busy = isSubmitting;
  const isCaregiver = role === 'caregiver';
  const showCounty = isCaregiver || countryCode === 'KE';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        // Dismissing the keyboard on a drag is what makes a long form on a
        // small screen navigable without hunting for a "done" key.
        keyboardDismissMode="on-drag"
      >
        <HeroHeader
          brand="LindaCare"
          tagline="Kenya Caregiving Platform"
          title="Create Account"
          subtitle="Join the secure caregiving network"
        />

        <View style={styles.body}>
          <RoleToggle
            value={role}
            onChange={switchRole}
            options={ROLE_OPTIONS}
            // Changing role mid-request would swap the schema out from under
            // an in-flight submission.
            disabled={busy}
          />

          <View style={styles.card}>
            <Controller
              control={control}
              name="fullName"
              render={({ field: { value, onChange, onBlur } }) => (
                <TextField
                  label="Full name"
                  placeholder="Enter your full name"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.fullName?.message}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                />
              )}
            />

            <Controller
              control={control}
              name="localNumber"
              render={({ field: { value, onChange, onBlur } }) => (
                <PhoneField
                  label="Phone number"
                  dialCode={dialCode}
                  editableDialCode={!isCaregiver}
                  onDialCodeChange={(next) => {
                    dialTouched.current = true;
                    setValue('dialCode', next, { shouldValidate: true });
                  }}
                  // Only digits reach form state; the field formats them for
                  // display. Storing the spaces would send them to the service.
                  value={value}
                  onChangeText={(text) => onChange(cleanDigits(text))}
                  onBlur={onBlur}
                  error={errors.localNumber?.message}
                />
              )}
            />

            {isCaregiver ? (
              <Controller
                control={control}
                name="nationalId"
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextField
                    label="National ID number"
                    placeholder="e.g. 32847291"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.nationalId?.message}
                    keyboardType="number-pad"
                    maxLength={10}
                    hint="Used to verify your identity. We store a secure hash, never the number itself"
                    returnKeyType="next"
                  />
                )}
              />
            ) : null}

            <Controller
              control={control}
              name="email"
              render={({ field: { value, onChange, onBlur } }) => (
                <TextField
                  label="Email address"
                  // Marked optional because it is. The mockups show no marker,
                  // which would read as required, and a caregiver without an
                  // email address is a real person this platform is for.
                  optional
                  placeholder="yourname@email.com"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                />
              )}
            />

            {!isCaregiver ? (
              <Controller
                control={control}
                name="countryCode"
                render={({ field: { value, onChange, onBlur } }) => (
                  <SelectField
                    label="Country of residence"
                    placeholder="Select country"
                    options={COUNTRY_OPTIONS}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    error={errors.countryCode?.message}
                    searchPlaceholder="Search countries"
                  />
                )}
              />
            ) : null}

            {showCounty ? (
              <Controller
                control={control}
                name="county"
                render={({ field: { value, onChange, onBlur } }) => (
                  <SelectField
                    label="County"
                    placeholder="Select county"
                    options={COUNTY_OPTIONS}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    error={errors.county?.message}
                    searchPlaceholder="Search counties"
                  />
                )}
              />
            ) : null}

            {!isCaregiver ? (
              <>
                <Controller
                  control={control}
                  name="relationshipToRecipient"
                  render={({ field: { value, onChange, onBlur } }) => (
                    <SelectField
                      label="Relationship to family member"
                      placeholder="Select relationship"
                      options={RELATIONSHIP_OPTIONS}
                      value={value}
                      onChange={onChange}
                      onBlur={onBlur}
                      error={errors.relationshipToRecipient?.message}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="careRecipientName"
                  render={({ field: { value, onChange, onBlur } }) => (
                    <TextField
                      label="Family member's name"
                      placeholder="Their full name"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.careRecipientName?.message}
                      autoCapitalize="words"
                      returnKeyType="done"
                    />
                  )}
                />
              </>
            ) : null}

            <Controller
              control={control}
              name="consent"
              render={({ field: { value, onChange, onBlur } }) => (
                <Checkbox
                  checked={value === true}
                  onChange={onChange}
                  onBlur={onBlur}
                  error={errors.consent?.message}
                  accessibilityLabel="I agree to LindaCare processing my personal data"
                >
                  I agree to LindaCare processing my personal data to match and
                  deliver care, as described in the Privacy Notice.
                </Checkbox>
              )}
            />
          </View>

          <Banner tone="success">
            {isCaregiver
              ? 'Your identity will be verified by SMS code and cross-checked against national ID records for platform security.'
              : 'Your phone number will be verified by SMS code before your account is created.'}
          </Banner>

          {submitError ? (
            <Banner tone={submitError.tone} style={styles.submitError}>
              {submitError.text}
            </Banner>
          ) : null}

          <PrimaryButton
            label={isCaregiver ? 'Register & Verify Identity' : 'Register & Verify Number'}
            loadingLabel={'Sending code…'}
            loading={busy}
            onPress={handleSubmit(onSubmit)}
            accessibilityHint="Sends a six-digit code to your phone"
          />

          {/* Never a disabled button with no explanation: the submit above is
              live at all times and failing validation puts the reasons on the
              fields, which is more use than a button that cannot be pressed. */}
          <Text style={styles.reassurance}>
            We&rsquo;ll text you a 6-digit code to confirm this number.
          </Text>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Pressable
              onPress={() => navigation.navigate('Login')}
              hitSlop={10}
              accessibilityRole="link"
              accessibilityLabel="Sign in to an existing account"
            >
              <Text style={styles.footerLink}>Sign In</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.navy },
  scroll: { backgroundColor: colors.page, flexGrow: 1, paddingBottom: space.xxxl },

  body: {
    paddingHorizontal: space.xl,
    // Pulls the toggle up over the header's lower edge, as in the mockups.
    marginTop: -space.xl,
    gap: space.lg,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    // The last field in the card carries its own bottom margin; this cancels
    // it so the card's internal spacing stays even.
    paddingBottom: space.xl - space.lg,
    ...shadow.card,
  },

  submitError: { marginTop: -space.xs },

  reassurance: {
    ...type.caption,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: -space.sm,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: space.sm,
  },
  footerText: { ...type.caption, color: colors.inkMuted },
  footerLink: { ...type.captionMedium, color: colors.link, fontFamily: type.button.fontFamily },
});
