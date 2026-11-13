import { useMemo, useState } from 'react';
import {
  FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Label from './Label';
import FieldError from './FieldError';
import { colors, radius, shadow, space, type, TOUCH_TARGET } from '../theme/tokens';

/*
 * A dropdown, drawn as the mockups draw it and opened as a full-height sheet.
 *
 * ── Why not a picker library ──
 *
 * React Native has no cross-platform select. The usual answer is
 * @react-native-picker/picker, which renders a Material spinner on Android and
 * a wheel on iOS -- two different interactions, neither of which looks like
 * the mockup, and the Android one is close to unusable at 47 options. This is
 * a list in a modal: one interaction, searchable, and the row height is a real
 * touch target.
 *
 * ── Why the search box appears when it does ──
 *
 * Above a dozen options, scrolling to find a county is slower than typing
 * three letters of it. Below that, a search box is a box in the way. The
 * threshold is a judgement, not a standard.
 */
const SEARCH_THRESHOLD = 12;

export default function SelectField({
  label,
  placeholder = 'Select an option',
  options,
  value,
  onChange,
  onBlur,
  error,
  optional = false,
  searchPlaceholder = 'Search',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value);
  const searchable = options.length > SEARCH_THRESHOLD;

  const visible = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
    // Closing the sheet is what counts as leaving the field, so validation
    // runs on dismissal whether or not anything was picked.
    onBlur?.();
  };

  const pick = (option) => {
    onChange(option.value);
    setOpen(false);
    setQuery('');
    onBlur?.();
  };

  return (
    <View style={styles.wrap}>
      <Label optional={optional}>{label}</Label>

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={({ pressed }) => [
          styles.control,
          Boolean(error) && styles.controlError,
          disabled && styles.controlDisabled,
          pressed && !disabled && styles.controlPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected ? selected.label : 'Nothing selected' }}
        accessibilityHint={error || `Opens a list of ${options.length} options`}
        accessibilityState={{ disabled, expanded: open, invalid: Boolean(error) }}
      >
        <Text
          style={[styles.value, !selected && styles.valuePlaceholder]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons
          name="chevron-down"
          size={18}
          color={disabled ? colors.disabledInk : colors.label}
        />
      </Pressable>

      <FieldError message={error} />

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={close}
        // Android's hardware back button closes the sheet rather than leaving
        // the screen, which is what onRequestClose is for.
      >
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropFill} onPress={close} accessibilityLabel="Close" />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable
                onPress={close}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.sheetClose}
              >
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>

            {searchable ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.placeholder}
                style={styles.search}
                autoCorrect={false}
                accessibilityLabel={`Search ${label}`}
                returnKeyType="search"
              />
            ) : null}

            <FlatList
              data={visible}
              keyExtractor={(item) => String(item.value)}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>No match for “{query.trim()}”</Text>
              }
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    onPress={() => pick(item)}
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                      {item.label}
                    </Text>
                    {isSelected ? (
                      <Ionicons name="checkmark" size={18} color={colors.teal} />
                    ) : null}
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

  control: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  controlPressed: { borderColor: colors.fieldBorderFocus },
  controlError: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  controlDisabled: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg },

  value: { ...type.body, color: colors.ink, flex: 1 },
  valuePlaceholder: { color: colors.placeholder },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11, 32, 51, 0.45)' },
  backdropFill: { flex: 1 },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    // Capped so the sheet never covers the whole screen: seeing a sliver of
    // the form behind it is what makes it read as a layer rather than a page.
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
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
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

  list: { paddingHorizontal: space.sm },
  option: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: space.md,
    borderRadius: radius.sm,
  },
  optionPressed: { backgroundColor: colors.field },
  optionText: { ...type.body, color: colors.ink, flex: 1 },
  optionTextSelected: { fontFamily: type.bodyMedium.fontFamily, color: colors.teal },

  empty: {
    ...type.body,
    color: colors.inkMuted,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
});
