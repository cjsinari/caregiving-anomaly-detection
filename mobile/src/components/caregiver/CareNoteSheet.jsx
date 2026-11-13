import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import PillButton from '../oneui/PillButton';
import Banner from '../Banner';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * Add a care note, or file an incident report. Item 6 of issue #44.
 *
 * ── Why one sheet and not two screens ──
 *
 * They are the same act -- writing down what happened -- recorded at two
 * different severities, and the difference is one the caregiver should be
 * able to change their mind about halfway through typing. Two separate
 * screens would mean going back, losing the text, and starting again to
 * reclassify something as an incident. A segmented control at the top of one
 * sheet costs a tap and loses nothing.
 *
 * ── Why an incident asks for more ──
 *
 * A note is for the record. An incident is read by a supervisor, possibly
 * days later, possibly as part of answering a complaint, and "client fell"
 * with no time and no description of what followed is worse than useless to
 * them. So the minimum length goes up and the placeholder asks the three
 * questions a supervisor will have. It is still the caregiver's words, not a
 * form of checkboxes -- the thing that actually happened rarely fits a
 * taxonomy written in advance.
 *
 * ── The draft survives a mis-tap ──
 *
 * Tapping outside the sheet does not discard what has been typed: it asks.
 * Losing four sentences written standing in someone's kitchen because a thumb
 * brushed the scrim is the kind of thing that stops people writing notes at
 * all.
 */
const MIN_NOTE = 10;
const MIN_INCIDENT = 30;
const MAX = 2000;

export default function CareNoteSheet({ visible, onClose, onSubmit, recipientName }) {
  const [kind, setKind] = useState('note');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  // A fresh sheet every time it opens. Reopening onto the last note, already
  // filed, and filing it twice is a real way to duplicate a care record.
  useEffect(() => {
    if (visible) {
      setKind('note');
      setBody('');
      setError(null);
      setSubmitting(false);
      setConfirmingClose(false);
    }
  }, [visible]);

  const minimum = kind === 'incident' ? MIN_INCIDENT : MIN_NOTE;
  const trimmed = body.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < minimum;
  const canSubmit = trimmed.length >= minimum && !submitting;

  const attemptClose = () => {
    if (trimmed.length && !submitting) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ body: trimmed, kind });
      onClose();
    } catch (err) {
      setSubmitting(false);
      setError(err?.message || 'Could not save that note. Please try again.');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={attemptClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropFill}
          onPress={attemptClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.grabber} />

            <View style={styles.head}>
              <View style={styles.headText}>
                <Text style={styles.title} accessibilityRole="header">
                  {kind === 'incident' ? 'Incident report' : 'Care note'}
                </Text>
                {recipientName ? (
                  <Text style={styles.subtitle}>{recipientName}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={attemptClose}
                hitSlop={10}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
            >
              {/* ── note or incident ── */}
              <View
                style={styles.segments}
                accessibilityRole="radiogroup"
                accessibilityLabel="What kind of entry is this"
              >
                {[
                  { value: 'note', label: 'Care note', icon: 'document-text-outline' },
                  { value: 'incident', label: 'Incident', icon: 'warning-outline' },
                ].map((option) => {
                  const selected = kind === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setKind(option.value)}
                      style={[styles.segment, selected && styles.segmentActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={option.label}
                    >
                      <Ionicons
                        name={option.icon}
                        size={15}
                        color={selected ? colors.onNavy : colors.inkMuted}
                      />
                      <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {kind === 'incident' ? (
                <Banner tone="warning" title="This goes to the supervisor">
                  An incident report is reviewed, timestamped and kept with the care record.
                  Write what happened, what you did about it, and who you told.
                </Banner>
              ) : null}

              {error ? <Banner tone="error" title="Not saved">{error}</Banner> : null}

              <View>
                <TextInput
                  value={body}
                  onChangeText={(text) => setBody(text.slice(0, MAX))}
                  placeholder={kind === 'incident'
                    ? 'e.g. At 15:10 the client slipped getting out of the chair. No injury; I helped her up and checked for bruising. Informed her son by phone at 15:20.'
                    : 'e.g. Blood pressure 128/84. Good spirits, ate a full lunch. No falls or incidents.'}
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  multiline
                  textAlignVertical="top"
                  autoFocus
                  /*
                   * Not "Care note" / "Incident": those are the names of the
                   * two radio buttons above, and two controls sharing a name
                   * inside one sheet is an ambiguity for anybody navigating
                   * by name rather than by position.
                   */
                  accessibilityLabel={
                    kind === 'incident' ? 'Incident report details' : 'Care note details'
                  }
                  accessibilityHint={`At least ${minimum} characters`}
                />
                <View style={styles.counterRow}>
                  {tooShort ? (
                    <Text style={styles.hint} accessibilityLiveRegion="polite">
                      {`${minimum - trimmed.length} more ${minimum - trimmed.length === 1 ? 'character' : 'characters'} needed`}
                    </Text>
                  ) : <View />}
                  <Text style={styles.counter}>{`${trimmed.length} / ${MAX}`}</Text>
                </View>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <PillButton
                label={kind === 'incident' ? 'File incident report' : 'Save care note'}
                icon={kind === 'incident' ? 'warning' : 'checkmark'}
                onPress={submit}
                disabled={!canSubmit}
                loading={submitting}
                full
              />
              {/* The reason the button is dead is always written down. */}
              {!canSubmit && !submitting ? (
                <Text style={styles.footerHint}>
                  {trimmed.length === 0
                    ? 'Write what happened to save this.'
                    : `A little more detail first — at least ${minimum} characters.`}
                </Text>
              ) : null}
            </View>

            {/* ── the discard guard ── */}
            {confirmingClose ? (
              <View style={styles.confirm}>
                <Text style={styles.confirmText}>Discard what you have written?</Text>
                <View style={styles.confirmRow}>
                  <PillButton
                    label="Keep writing"
                    variant="tonal"
                    size="sm"
                    onPress={() => setConfirmingClose(false)}
                  />
                  <PillButton
                    label="Discard"
                    variant="danger"
                    size="sm"
                    onPress={onClose}
                  />
                </View>
              </View>
            ) : null}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11, 32, 51, 0.5)' },
  backdropFill: { flex: 1 },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: oneui.radius.sheet,
    borderTopRightRadius: oneui.radius.sheet,
    paddingTop: space.md,
    maxHeight: '92%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: oneui.radius.pill,
    backgroundColor: colors.fieldBorder,
    marginBottom: space.md,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    gap: space.md,
  },
  headText: { flex: 1 },
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.caption, color: colors.inkMuted },
  close: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: -space.sm,
  },

  body: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.lg },

  segments: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.field,
    borderRadius: oneui.radius.pill,
    padding: space.xs,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: TOUCH_TARGET - 8,
    borderRadius: oneui.radius.pill,
  },
  segmentActive: { backgroundColor: colors.navy },
  segmentText: { ...type.captionMedium, color: colors.inkMuted },
  segmentTextActive: { fontFamily: type.button.fontFamily, color: colors.onNavy },

  input: {
    minHeight: 150,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: oneui.radius.inner,
    backgroundColor: colors.field,
    padding: space.lg,
    ...type.body,
    color: colors.ink,
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
    minHeight: 18,
  },
  hint: { ...type.caption, fontSize: 12, color: colors.warning },
  counter: { ...type.caption, fontSize: 11, color: colors.placeholder },

  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.fieldBorder,
  },
  footerHint: { ...type.caption, fontSize: 12, color: colors.inkMuted, textAlign: 'center' },

  confirm: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
    borderTopLeftRadius: oneui.radius.sheet,
    borderTopRightRadius: oneui.radius.sheet,
  },
  confirmText: { ...type.title, fontSize: 17, color: colors.ink, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: space.md },
});
