import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Label from './Label';
import FieldError from './FieldError';
import { colors, radius, space, type, TOUCH_TARGET } from '../theme/tokens';

/*
 * A labelled text input, the shape every field on the registration form takes.
 *
 * Uncontrolled from React Hook Form's point of view is not an option here --
 * RN has no uncontrolled inputs the way the DOM does -- so the form drives
 * this through a Controller and passes value/onChangeText down.
 *
 * ── Accessibility ──
 *
 * The label is associated by `accessibilityLabel` rather than by proximity,
 * because a screen reader reading an RN form does not infer the relationship
 * from layout. When the field is in error the message is appended to the
 * spoken name through `accessibilityHint`, so the reason arrives with the
 * field instead of being announced separately and lost.
 */
const TextField = forwardRef(function TextField({
  label,
  optional = false,
  error,
  value,
  onChangeText,
  onBlur,
  hint,
  ...inputProps
}, ref) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <Label optional={optional}>{label}</Label>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        placeholderTextColor={colors.placeholder}
        style={[
          styles.input,
          focused && styles.inputFocused,
          // Error styling wins over focus: the thing most worth seeing is why
          // the field was rejected, not that the cursor is in it.
          Boolean(error) && styles.inputError,
        ]}
        accessibilityLabel={label}
        accessibilityHint={error || hint}
        // Announces the field as invalid, which is what a screen reader uses
        // to say "invalid data" alongside the name.
        accessibilityState={{ invalid: Boolean(error) }}
        {...inputProps}
      />
      <FieldError message={error} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...type.body,
    color: colors.ink,
  },
  // 4.45:1 against the field fill, which clears the 3:1 that WCAG 1.4.11 asks
  // of a focus indicator. The resting border does not, knowingly; see tokens.js.
  inputFocused: { borderColor: colors.fieldBorderFocus },
  inputError: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
});

export default TextField;
