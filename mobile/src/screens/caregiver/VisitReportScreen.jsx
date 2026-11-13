import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PortalShell from '../../components/caregiver/PortalShell';
import Card, { Divider, SectionHeading } from '../../components/oneui/Card';
import Chip, { VISIT_STATUS } from '../../components/oneui/Chip';
import PillButton from '../../components/oneui/PillButton';
import Touchable from '../../components/oneui/Touchable';
import TaskRow from '../../components/oneui/TaskRow';
import { ListError, ListSkeleton } from '../../components/oneui/ListState';
import Banner from '../../components/Banner';
import useAsyncResource from '../../hooks/useAsyncResource';
import useOptimisticTasks from '../../hooks/useOptimisticTasks';
import { care } from '../../api/caregiver';
import { useAuth } from '../../auth/AuthContext';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';
import { duration, shortDate, time } from '../../utils/datetime';
import { CONCERNING, WELLBEING } from '../../constants/wellbeing';

/*
 * The visit report: items 4, 5 and 6 of issue #44 in one screen, because they
 * are one act.
 *
 * A caregiver arrives, checks in, works through the tasks, forms a view of how
 * the person is, writes it down, and leaves. Splitting that into a checklist
 * screen, a check-in button somewhere else and a notes form at the end would
 * be three screens describing one visit, and the report would be assembled
 * from three places that can each be abandoned halfway.
 *
 * ── Times are recorded, not typed ──
 *
 * The mockup draws CHECK-IN TIME and CHECK-OUT TIME as fields with a clock
 * icon, which reads as "type the time here". They are not editable here, and
 * that is a deliberate departure.
 *
 * A visit report is a record of care delivered. It is what a family member
 * reads, what a supervisor reviews after a complaint, and -- in this system
 * specifically -- an input to the anomaly detection the rest of the platform
 * exists for. A free-text time field makes "I arrived at 14:00" an assertion
 * rather than an observation, and a caregiver running forty minutes late can
 * make the record say otherwise with four keystrokes. Worse, it makes every
 * *honest* report indistinguishable from a dishonest one, which quietly
 * destroys the value of the whole dataset.
 *
 * So the times come from the Check in and Check out buttons and show what was
 * actually recorded. If a time genuinely needs correcting -- a phone that was
 * flat, a visit started before the app was open -- that is a supervisor
 * amending the record with a reason attached, which is a different screen in a
 * different milestone, and far better than a text box.
 *
 * ── Why the tasks save as you tick them ──
 *
 * They are not form state waiting for a submit. A caregiver can be in a house
 * for ninety minutes; the phone can die, the app can be killed for memory, the
 * visit can be interrupted. Each tick is persisted when it happens (see
 * useOptimisticTasks for the optimistic update and the per-task rollback), so
 * an interrupted visit resumes where it was instead of starting from nothing.
 */

const MAX_NOTES = 2000;

export default function VisitReportScreen({ navigation, route }) {
  const { visitId, recipientId, autoCheckIn } = route.params || {};
  const { user } = useAuth();

  const [wellbeing, setWellbeing] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyAction, setBusyAction] = useState(null);

  /*
   * Resolve what is being reported on.
   *
   * Two ways in. From the schedule, with a visit. From an assignment card or
   * the New Report chooser, with only a person -- in which case the nearest
   * unfinished visit for them is used if there is one, and the report is filed
   * against the person alone if there is not. The second case is not an edge:
   * an unscheduled call-in is a real thing that happens and a report that
   * cannot be written without a calendar entry is a report that does not get
   * written.
   */
  const load = useCallback(async () => {
    if (visitId) {
      const visit = await care.visit(visitId);
      const recipient = await care.recipient(visit.recipientId);
      return { visit, recipient };
    }
    const recipient = await care.recipient(recipientId);
    const { visits } = await care.visits({ recipientId });
    const open = visits.find((v) => v.status !== 'completed') || null;
    return { visit: open, recipient };
  }, [visitId, recipientId]);

  const { status, data, error, reload, setData } = useAsyncResource(
    load, [visitId, recipientId], { enabled: Boolean(visitId || recipientId) }
  );

  const visit = data?.visit || null;
  const recipient = data?.recipient || null;

  const persistTask = useCallback(async (taskId, done) => {
    if (!visit) return;
    const updated = await care.setTask(visit.id, taskId, done);
    // Keep the resource in step without a reload, so a later refresh does not
    // find a visit whose tasks disagree with what is on screen.
    setData((current) => (current ? { ...current, visit: updated } : current));
  }, [visit, setData]);

  const tasks = useOptimisticTasks(visit?.tasks, persistTask);

  /*
   * Check in on arrival, when the dashboard sent us here to do exactly that.
   *
   * Guarded by a ref rather than by the visit's own state: the resource
   * reloads, and keying off `visit.checkInAt` would re-fire the moment a
   * reload briefly returned the pre-check-in copy.
   */
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoCheckIn || autoDone.current || !visit || visit.checkInAt) return;
    autoDone.current = true;
    runAction('checkIn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckIn, visit]);

  async function runAction(kind) {
    if (!visit) return;
    setBusyAction(kind);
    setActionError(null);
    try {
      const updated = kind === 'checkIn'
        ? await care.checkIn(visit.id)
        : await care.checkOut(visit.id);
      setData((current) => (current ? { ...current, visit: updated } : current));
    } catch (err) {
      setActionError(err?.message || 'Could not record that. Please try again.');
    } finally {
      setBusyAction(null);
    }
  }

  const trimmedNotes = notes.trim();
  const needsNotes = CONCERNING.has(wellbeing) && trimmedNotes.length < 15;

  /*
   * What has to be true before this can be filed.
   *
   * Three things, and each has a reason beyond tidiness:
   *
   *   a check-in     a report with no arrival time is not evidence of a visit
   *   a wellbeing    the one field a family member actually reads
   *   notes, when the wellbeing is Low or Unwell -- "Unwell" on its own tells
   *                  a supervisor that something is wrong and nothing about
   *                  what, which is the worst possible thing to leave in a
   *                  care record overnight
   */
  const blockers = useMemo(() => {
    const list = [];
    if (visit && !visit.checkInAt) list.push('Check in when you arrive.');
    if (!wellbeing) list.push('Choose how the client is doing.');
    if (needsNotes) list.push('Add a note explaining the wellbeing you chose.');
    return list;
  }, [visit, wellbeing, needsNotes]);

  const canSubmit = blockers.length === 0 && !submitting && Boolean(recipient);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await care.submitReport({
        visitId: visit?.id || null,
        recipientId: recipient.id,
        wellbeing,
        notes: trimmedNotes,
        tasks: tasks.tasks.filter((t) => t.done).map((t) => t.id),
        checkInAt: visit?.checkInAt || null,
        checkOutAt: visit?.checkOutAt || new Date().toISOString(),
        filedBy: user?.fullName || 'You',
      });
      /*
       * Back to the dashboard, not to a confirmation screen.
       *
       * The dashboard is where the result is visible -- the visit moves to
       * Completed and the counter goes up -- and a caregiver who has just
       * finished a visit is on their way to the next one, not looking for a
       * tick on a dedicated page.
       */
      navigation.navigate('CaregiverHome', { filed: recipient.fullName });
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err?.message || 'The report was not saved. Please try again.');
    }
  };

  const subtitle = recipient
    ? [recipient.fullName, visit?.location || recipient.address, shortDate()].filter(Boolean).join(' · ')
    : 'Loading…';

  return (
    <PortalShell
      navigation={navigation}
      active="VisitReport"
      barTitle="Visit Report"
      title="Visit Report"
      subtitle={subtitle}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('CaregiverHome'))}
      scroll={false}
      footer={(
        <View style={styles.footer}>
          <PillButton
            label="Submit Visit Report"
            icon="shield-checkmark"
            onPress={submit}
            disabled={!canSubmit}
            loading={submitting}
            full
          />
          {/* The button is never silently dead: when it cannot be pressed, the
              first thing standing in the way is named right underneath it. */}
          <Text style={styles.footerNote} accessibilityLiveRegion="polite">
            {submitting
              ? 'Filing the report…'
              : blockers.length
                ? blockers[0]
                : 'Reports are signed and tamper-evident once submitted.'}
          </Text>
        </View>
      )}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {status === 'loading' ? (
            <ListSkeleton rows={4} height={110} />
          ) : !recipient ? (
            <ListError
              error={error}
              onRetry={reload}
              title="Could not open this visit"
            />
          ) : (
            <>
              {submitError ? (
                <Banner tone="error" title="Not submitted">{submitError}</Banner>
              ) : null}

              {!visit ? (
                <Banner tone="info" title="No scheduled visit">
                  Nothing is on the calendar for {recipient.fullName} right now, so this will be
                  filed as an unscheduled visit. Times and tasks come from a scheduled visit.
                </Banner>
              ) : null}

              {/* ── visit times ── */}
              <View>
                <SectionHeading
                  action={visit ? (
                    <Chip
                      tone={(VISIT_STATUS[visit.status] || VISIT_STATUS.upcoming).tone}
                      label={(VISIT_STATUS[visit.status] || VISIT_STATUS.upcoming).label}
                      compact
                    />
                  ) : null}
                >
                  Visit Times
                </SectionHeading>

                <Card>
                  <View style={styles.timeRow}>
                    <TimeSlot
                      label="Check-in time"
                      value={visit?.checkInAt}
                      icon="log-in-outline"
                    />
                    <View style={styles.timeRule} />
                    <TimeSlot
                      label="Check-out time"
                      value={visit?.checkOutAt}
                      icon="log-out-outline"
                    />
                  </View>

                  {visit?.checkInAt && visit?.checkOutAt ? (
                    <>
                      <Divider inset={0} />
                      <Text style={styles.durationText}>
                        {`On site for ${duration(visit.checkInAt, visit.checkOutAt)}`}
                      </Text>
                    </>
                  ) : null}

                  {actionError ? (
                    <Text style={styles.actionError} accessibilityLiveRegion="polite">
                      {actionError}
                    </Text>
                  ) : null}

                  {visit ? (
                    <View style={styles.timeActions}>
                      {!visit.checkInAt ? (
                        <PillButton
                          label="Check in"
                          icon="log-in-outline"
                          onPress={() => runAction('checkIn')}
                          loading={busyAction === 'checkIn'}
                          full
                          accessibilityHint="Records the time you arrived"
                        />
                      ) : !visit.checkOutAt ? (
                        <PillButton
                          label="Check out"
                          icon="log-out-outline"
                          variant="tonal"
                          onPress={() => runAction('checkOut')}
                          loading={busyAction === 'checkOut'}
                          full
                          accessibilityHint="Records the time you left"
                        />
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              </View>

              {/* ── wellbeing ── */}
              <View>
                <SectionHeading>Client Wellbeing</SectionHeading>
                <Card>
                  <View
                    style={styles.wellbeingRow}
                    accessibilityRole="radiogroup"
                    accessibilityLabel="How is the client doing"
                  >
                    {WELLBEING.map((option) => {
                      const selected = wellbeing === option.value;
                      return (
                        <Touchable
                          key={option.value}
                          onPress={() => setWellbeing(option.value)}
                          style={[
                            styles.wellbeing,
                            selected && { borderColor: option.tone, backgroundColor: colors.field },
                          ]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={option.label}
                        >
                          <Text style={styles.wellbeingEmoji}>{option.emoji}</Text>
                          {/* Selected is a border, a fill *and* a tick. An
                              emoji that is merely outlined in a colour is not
                              a state anyone can see at arm's length. */}
                          <Text
                            style={[
                              styles.wellbeingLabel,
                              selected && { color: option.tone, fontFamily: type.button.fontFamily },
                            ]}
                          >
                            {option.label}
                          </Text>
                          {selected ? (
                            <View style={[styles.wellbeingTick, { backgroundColor: option.tone }]}>
                              <Ionicons name="checkmark" size={10} color={colors.surface} />
                            </View>
                          ) : null}
                        </Touchable>
                      );
                    })}
                  </View>
                </Card>
              </View>

              {/* ── tasks ── */}
              <View>
                <SectionHeading
                  action={visit && tasks.tasks.length ? (
                    <Text style={styles.taskCount}>
                      {`${tasks.doneCount} of ${tasks.tasks.length}`}
                    </Text>
                  ) : null}
                >
                  Tasks Completed
                </SectionHeading>

                {!visit || !tasks.tasks.length ? (
                  <Card style={styles.noTasks}>
                    <Ionicons name="list-outline" size={20} color={colors.label} />
                    <Text style={styles.noTasksText}>
                      {visit
                        ? 'No tasks were set for this visit. Describe what you did in the notes below.'
                        : 'Tasks come from a scheduled visit. Use the notes below instead.'}
                    </Text>
                  </Card>
                ) : (
                  <Card padded={false}>
                    {tasks.tasks.map((task, index) => (
                      <View key={task.id}>
                        {index > 0 ? <Divider inset={space.lg + 34} /> : null}
                        <TaskRow
                          label={task.label}
                          done={task.done}
                          pending={tasks.isPending(task.id)}
                          error={tasks.errorFor(task.id)}
                          onToggle={() => tasks.toggle(task.id)}
                        />
                      </View>
                    ))}
                  </Card>
                )}
              </View>

              {/* ── notes ── */}
              <View>
                <SectionHeading>Visit Notes</SectionHeading>
                <Card>
                  <Text style={styles.notesHint}>
                    Observations, concerns, or anything the supervisor should know.
                  </Text>
                  <TextInput
                    value={notes}
                    onChangeText={(text) => setNotes(text.slice(0, MAX_NOTES))}
                    placeholder="e.g. Client was in good spirits. Blood pressure 128/84. Administered afternoon medication. No falls or incidents to report."
                    placeholderTextColor={colors.placeholder}
                    style={[styles.notesInput, needsNotes && styles.notesInputNeeded]}
                    multiline
                    textAlignVertical="top"
                    accessibilityLabel="Visit notes"
                    accessibilityHint={
                      needsNotes
                        ? 'Required, because you marked the client as low or unwell'
                        : 'Optional'
                    }
                  />
                  <View style={styles.notesFoot}>
                    {needsNotes ? (
                      <Text style={styles.notesNeeded} accessibilityLiveRegion="polite">
                        Please say a little about what you saw.
                      </Text>
                    ) : <View />}
                    <Text style={styles.notesCount}>
                      {`${trimmedNotes.length} chars`}
                    </Text>
                  </View>
                </Card>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </PortalShell>
  );
}

/** One half of the times card: a recorded instant, or a visible blank. */
function TimeSlot({ label, value, icon }) {
  const recorded = Boolean(value);
  return (
    <View
      style={styles.timeSlot}
      accessible
      accessibilityLabel={`${label}: ${recorded ? time(value) : 'not recorded yet'}`}
    >
      <Text style={styles.timeLabel}>{label.toUpperCase()}</Text>
      <View style={[styles.timeBox, recorded && styles.timeBoxFilled]}>
        <Text style={[styles.timeValue, !recorded && styles.timeValueEmpty]}>
          {recorded ? time(value) : '--:--'}
        </Text>
        <Ionicons
          name={icon}
          size={15}
          color={recorded ? colors.teal : colors.placeholder}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.xl },

  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  timeRule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.fieldBorder },
  timeSlot: { flex: 1, gap: space.sm },
  timeLabel: { ...type.label, fontSize: 10, color: colors.label },
  timeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOUCH_TARGET - 4,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: oneui.radius.control,
    backgroundColor: colors.field,
    paddingHorizontal: space.md,
  },
  timeBoxFilled: { borderColor: colors.tealSoft, backgroundColor: colors.tealSoft },
  timeValue: { ...type.bodyMedium, fontSize: 16, color: colors.ink, letterSpacing: 1 },
  timeValueEmpty: { color: colors.placeholder },
  durationText: { ...type.caption, fontSize: 12, color: colors.inkMuted, paddingTop: space.md },
  actionError: { ...type.caption, fontSize: 12, color: colors.danger, paddingTop: space.md },
  timeActions: { paddingTop: space.lg },

  wellbeingRow: { flexDirection: 'row', gap: space.sm },
  wellbeing: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: oneui.radius.inner,
    paddingVertical: space.md,
  },
  wellbeingEmoji: { fontSize: 22, lineHeight: 28 },
  wellbeingLabel: { ...type.caption, fontSize: 11, color: colors.inkMuted },
  wellbeingTick: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  taskCount: { ...type.captionMedium, fontSize: 12, color: colors.inkMuted },
  noTasks: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  noTasksText: { ...type.caption, color: colors.inkMuted, flex: 1 },

  notesHint: { ...type.caption, fontSize: 12, color: colors.inkMuted, marginBottom: space.md },
  notesInput: {
    minHeight: 130,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
    borderRadius: oneui.radius.inner,
    backgroundColor: colors.field,
    padding: space.md,
    ...type.body,
    fontSize: 14,
    color: colors.ink,
  },
  notesInputNeeded: { borderColor: colors.warning },
  notesFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
    minHeight: 16,
  },
  notesNeeded: { ...type.caption, fontSize: 11, color: colors.warning, flex: 1 },
  notesCount: { ...type.caption, fontSize: 11, color: colors.placeholder },

  footer: { gap: space.sm, paddingBottom: space.xs },
  footerNote: { ...type.caption, fontSize: 11, color: colors.inkMuted, textAlign: 'center' },
});
