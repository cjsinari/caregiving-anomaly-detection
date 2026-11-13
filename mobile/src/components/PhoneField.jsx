import { useMemo, useState } from 'react';
import {
  FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Label from './Label';
import FieldError from './FieldError';
import { COUNTRIES } from '../data/locality';
import { formatLocal } from '../validation/phone';
import { colors, radius, shadow, space, type, TOUCH_TARGET } from '../theme/tokens';

/*
 * The phone input from the mockups: a dial-code chip beside the local number.
 *
 * ── Why the chip is sometimes a button and sometimes not ──
 *
 * For a caregiver it is fixed at +254 and rendered as a plain chip. A
 * caregiver delivers care in person in a Kenyan county; a caregiver with a
 * German mobile is a data-entry error, and an inert chip says so more clearly
 * than a validation message after the fact.
 *
 * For a family member it opens a picker, because a large share of them follow
 * a parent's care from abroad. It is deliberately independent of the country
 * dropdown: living in Manchester and keeping a Safaricom number is ordinary,
 * and so is the reverse. The screen seeds this from the chosen country as a
 * convenience and then leaves it alone.
 *
 * ── Why the number is formatted while typing ──
 *
 * "712 345 678" is checkable at a glance; "712345678" is not, and this is the
 * one field where a single wrong digit means the verification code goes to a
 * stranger. The grouping is cosmetic -- every consumer of the value strips it.
 */
export default function PhoneField({
  label = 'Phone number',
  dialCode,
  onDialCodeChange,
  value,
  onChangeText,
  onBlur,
  error,
  editableDialCode = false,
  placeholder = '7XX XXX XXX',
}) {
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  // One entry per distinct dial code: the list is of codes, not of countries,
  // and five entries reading "+1" would be five identical-looking choices.
  const dialOptions = useMemo(() => {
    const seen = new Map();
    COUNTRIES.filter((c) => c.dialCode).forEach((c) => {
      if (!seen.has(c.dialCode)) seen.set(c.dialCode, { dialCode: c.dialCode, names: [c.name] });
      else seen.get(c.dialCode).names.push(c.name);
    });
    return [...seen.values()].map((entry) => ({
      value: entry.dialCode,
      label: `${entry.dialCode}  ${entry.names.join(', ')}`,
    }));
  }, []);

  const visibleOptions = useMemo(() => {
    if (!query.trim()) return dialOptions;
    const q = query.trim().toLowerCase();
    return dialOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [dialOptions, query]);

  const closePicker = () => { setPickerOpen(false); setQuery(''); };

  return (
    <View style={styles.wrap}>
      <Label>{label}</Label>

      <View style={styles.row}>
        {editableDialCode ? (
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => [styles.chip, styles.chipButton, pressed && styles.chipPressed]}
            accessibilityRole="button"
            accessibilityLabel="Country dialling code"
            accessibilityValue={{ text: dialCode }}
            accessibilityHint="Opens a list of dialling codes"
          >
            <Text style={styles.chipText}>{dialCode}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.label} />
          </Pressable>
        ) : (
          // Not a button, and not disabled either: a disabled control invites
          // someone to wonder how to enable it. This is simply the prefix.
          <View style={styles.chip} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={styles.chipText}>{dialCode}</Text>
          </View>
        )}

        <TextInput
          value={formatLocal(value)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={14}
          style={[
            styles.input,
            focused && styles.inputFocused,
            Boolean(error) && styles.inputError,
          ]}
          accessibilityLabel={`${label}, country code ${dialCode}`}
          accessibilityHint={error}
          accessibilityState={{ invalid: Boolean(error) }}
        />
      </View>

      <FieldError message={error} />

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={closePicker}>
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropFill} onPress={closePicker} accessibilityLabel="Close" />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Dialling code</Text>
              <Pressable
                onPress={closePicker}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.sheetClose}
              >
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search country or code"
              placeholderTextColor={colors.placeholder}
              style={styles.search}
              autoCorrect={false}
              accessibilityLabel="Search dialling codes"
            />
            <FlatList
              data={visibleOptions}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>No match for “{query.trim()}”</Text>}
              renderItem={({ item }) => {
                const isSelected = item.value === dialCode;
                return (
                  <Pressable
                    onPress={() => { onDialCodeChange(item.value); closePicker(); }}
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      style={[styles.optionText, isSelected && styles.optionTextSelected]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    {isSelected ? <Ionicons name="checkmark" size={18} color={colors.teal} /> : null}
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  row: { flexDirection: 'row', gap: space.sm },

  chip: {
    minHeight: TOUCH_TARGET,
    minWidth: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  chipButton: { paddingHorizontal: space.md },
  chipPressed: { borderColor: colors.fieldBorderFocus },
  chipText: { ...type.bodyMedium, color: colors.ink },

  input: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...type.body,
    color: colors.ink,
    // Phone numbers are read back digit by digit far more often than they are
    // read as words, and the extra tracking is what makes that possible.
    letterSpacing: 0.6,
  },
  inputFocused: { borderColor: colors.fieldBorderFocus },
  inputError: { borderColor: colors.danger, backgroundColor: colors.dangerBg },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11, 32, 51, 0.45)' },
  backdropFill: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: '75%',
    paddingTop: space.md,
    ...shadow.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.fieldBorder,
    marginBottom: space.md,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  sheetTitle: { ...type.title, color: colors.ink, flex: 1 },
  sheetClose: {
    width: TOUCH_TARGET, height: TOUCH_TARGET,
    alignItems: 'flex-end', justifyContent: 'center',
  },
  search: {
    marginHorizontal: space.xl,
    marginBottom: space.sm,
    minHeight: TOUCH_TARGET,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    paddingHorizontal: space.lg,
    ...type.body,
    color: colors.ink,
  },
  option: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: space.lg,
    borderRadius: radius.sm,
  },
  optionPressed: { backgroundColor: colors.field },
  optionText: { ...type.body, color: colors.ink, flex: 1 },
  optionTextSelected: { fontFamily: type.bodyMedium.fontFamily, color: colors.teal },
  empty: { ...type.body, color: colors.inkMuted, textAlign: 'center', paddingVertical: space.xl },
});
