import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Label from './Label';
import FieldError from './FieldError';
import { colors, radius, space, type, TOUCH_TARGET } from '../theme/tokens';

const LENGTH = 6;
const BOX_HEIGHT = TOUCH_TARGET + 8;

/*
 * The six-digit code entry from the mockups.
 *
 * -- Why this is one input and not six --
 *
 * Six separate boxes, each a TextInput that moves focus to the next, is the
 * obvious reading of the design and it is a reliable source of bugs: backspace
 * on an empty box has to walk backwards, a pasted code lands entirely in the
 * first box, and the SMS autofill both platforms offer fills one box and
 * discards five digits.
 *
 * So there is one real input holding all six digits, drawn as six boxes. The
 * boxes are presentation; the input is the field. Autofill, paste, backspace
 * and the keyboard's own behaviour then all work, because none of them are
 * being reimplemented.
 *
 * `textContentType="oneTimeCode"` is what makes iOS offer the code from the
 * SMS above the keyboard, and `autoComplete="sms-otp"` is the Android
 * equivalent. Both matter more here than anywhere else in the app: this screen
 * stands between someone and their account, and the alternative is memorising
 * six digits from a notification.
 */
export default function OtpInput({
  label = 'Verification code',
  value,
  onChangeText,
  onBlur,
  error,
  autoFocus = true,
  editable = true,
}) {
  const input = useRef(null);
  const [focused, setFocused] = useState(false);

  const digits = String(value || '').replace(/\D/g, '').slice(0, LENGTH);
  const boxes = Array.from({ length: LENGTH }, (_, i) => digits[i] || '');
  // Where the next digit lands, so exactly one box shows as active.
  const cursor = Math.min(digits.length, LENGTH - 1);

  return (
    <View style={styles.wrap}>
      <Label>{label}</Label>

      {/* Positioning context for the real input, laid over the boxes. */}
      <View style={styles.field}>
        <Pressable
          onPress={() => input.current?.focus()}
          style={styles.row}
          // The row is decoration wrapped around a real input. Exposing it as
          // a second focusable thing would have a screen reader announce the
          // field twice and offer a tap that only moves focus to where it
          // already is.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {boxes.map((digit, index) => (
            <View
              key={index}
              style={[
                styles.box,
                Boolean(digit) && styles.boxFilled,
                focused && index === cursor && !digit && styles.boxActive,
                Boolean(error) && styles.boxError,
              ]}
            >
              <Text style={styles.digit}>{digit}</Text>
            </View>
          ))}
        </Pressable>

        {/*
          The real field: full-size over the boxes, and invisible.

          Not `display: none` and not zero-sized. A hidden input cannot be
          focused on either platform, and a zero-sized one makes the keyboard
          and the caret behave unpredictably. Transparent and full-size keeps
          every native behaviour -- caret, autofill, paste -- intact.
        */}
        <TextInput
          ref={input}
          value={digits}
          onChangeText={(next) => onChangeText(next.replace(/\D/g, '').slice(0, LENGTH))}
          onFocus={() => setFocused(true)}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={LENGTH}
          autoFocus={autoFocus}
          editable={editable}
          style={styles.hidden}
          accessibilityLabel={label}
          accessibilityHint={error || `Enter the ${LENGTH} digit code`}
          accessibilityState={{ invalid: Boolean(error) }}
        />
      </View>

      <FieldError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  field: { position: 'relative' },
  row: { flexDirection: 'row', gap: space.sm, justifyContent: 'space-between' },
  box: {
    flex: 1,
    minHeight: BOX_HEIGHT,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.fieldBorderFocus, backgroundColor: colors.surface },
  boxActive: { borderColor: colors.teal },
  boxError: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  digit: { ...type.title, color: colors.ink },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BOX_HEIGHT,
    opacity: 0,
    // Belt and braces: opacity 0 hides the caret and the text already, and a
    // transparent colour means a platform that ignores opacity on a focused
    // input still does not show two sets of digits.
    color: 'transparent',
  },
});
