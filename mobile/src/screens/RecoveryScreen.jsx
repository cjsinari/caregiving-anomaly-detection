import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import HeroHeader from '../components/HeroHeader';
import TextField from '../components/TextField';
import PrimaryButton from '../components/PrimaryButton';
import Banner from '../components/Banner';
import { auth } from '../api/endpoints';
import { bannerFor } from '../auth/errors';
import {
  recoverySchema, recoveryDefaults, toContact, channelFor, SERVICE_FIELD_TO_FORM_FIELD,
} from '../validation/recovery';
import { colors, radius, shadow, space, type } from '../theme/tokens';

/*
 * "I cannot get into my account."
 *
 * The case this exists for is a caregiver or a family member whose phone
 * number has changed, whose handset is gone, or whose SIM was swapped. They
 * cannot receive the sign-in code, so the whole OTP flow is closed to them,
 * and without this screen their only route back is support.
 *
 * -- One field, not a choice of two --
 *
 * Someone in this position does not reliably remember whether they registered
 * with an email address or only a phone number. Asking them to pick first adds
 * a decision they may get wrong, and getting it wrong looks exactly like not
 * having an account. So the field takes either and works out which it is.
 *
 * -- Why the next screen is reached whatever happens --
 *
 * The service answers identically for a registered contact, an unregistered
 * one, a locked account and a mail server that is down. That is deliberate:
 * this endpoint takes an arbitrary address from anyone, so any answer that
 * varied with what was found would answer "does this person use LindaCare?" to
 * whoever asked. The cost is that a typo looks like success, which is why the
 * next screen names the contact the code was sent to and offers a way back.
 */
export default function RecoveryScreen({ navigation }) {
  const [banner, setBanner] = useState(null);
  const inFlight = useRef(false);

  const {
    control, handleSubmit, formState: { errors, isSubmitting }, setError,
  } = useForm({
    resolver: zodResolver(recoverySchema),
    defaultValues: recoveryDefaults(),
    mode: 'onTouched',
  });

  const onSubmit = async (values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBanner(null);

    const contact = toContact(values.contact);

    try {
      const result = await auth.requestRecovery(contact);
      navigation.navigate('Verify', {
        contact,
        purpose: 'recovery',
        // The service echoes the channel it derived from the input; falling
        // back to the local derivation keeps the next screen honest if an
        // older build of the service does not send one.
        channel: result?.channel || channelFor(contact),
      });
    } catch (err) {
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
        icon="key-outline"
        title="Recover your account"
        subtitle="We will send a code to a contact already on your account"
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
        backLabel="Sign in"
      />

      <View style={styles.body}>
        {banner ? <Banner tone={banner.tone} title={banner.title}>{banner.message}</Banner> : null}

        <View style={styles.card}>
          <Controller
            control={control}
            name="contact"
            render={({ field }) => (
              <TextField
                label="Email or phone number"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.contact?.message}
                placeholder="you@example.com or 0712 345 678"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                hint="Whichever you registered with. If your number has changed, use your email address."
              />
            )}
          />

          <Text style={styles.note}>
            No password is involved. We will send a 6-digit code and sign you back in.
          </Text>

          <PrimaryButton
            label="Send Recovery Code"
            loadingLabel={'Sending code…'}
            loading={isSubmitting}
            onPress={handleSubmit(onSubmit)}
          />
        </View>

        <Banner tone="info" title="No email on your account?">
          If you only registered a phone number and no longer have it, contact LindaCare
          support — they can verify you another way.
        </Banner>

        <View style={styles.footer}>
          <Pressable
            onPress={() => navigation.navigate('Login')}
            hitSlop={10}
            accessibilityRole="link"
            accessibilityLabel="Back to sign in"
          >
            <Text style={styles.link}>Back to sign in</Text>
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
  note: { ...type.caption, color: colors.inkMuted, marginBottom: space.lg },
  footer: { alignItems: 'center' },
  link: { ...type.button, color: colors.link },
});
