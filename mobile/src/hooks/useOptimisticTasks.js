import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Ticking a task, and putting it back when the service says no.
 *
 * This is acceptance criterion 2 of issue #44 -- "completing a task updates
 * the UI immediately (optimistic update with rollback on failure)" -- and it
 * is the one piece of this milestone that genuinely needs its own hook rather
 * than a few lines in a screen.
 *
 * ── What makes it harder than it looks ──
 *
 * The naive version keeps a copy of the task before the write and restores it
 * on failure. That is wrong as soon as a second tap lands while the first is
 * still in flight, which on a five-task checklist is the normal case, not an
 * edge one: somebody ticks Medication, Meals and Hygiene in under a second.
 * Then
 *
 *   - two writes race, and the slower reply overwrites the newer state;
 *   - a failure rolls back to a snapshot taken before the *other* two ticks,
 *     silently unticking tasks that saved perfectly well;
 *   - a tick and an untick of the same task can land out of order, leaving
 *     the screen disagreeing with the service with no error to explain it.
 *
 * So the rollback is per task and is keyed to the attempt. Each tap is a
 * sequence number. A reply is only allowed to settle its own task, and only if
 * it is still the newest attempt for that task -- anything older is a reply to
 * a question that has since been asked again, and is dropped. Rolling back
 * restores the value that task had before *its* tap, which leaves every other
 * task alone.
 *
 * ── Why the list is held in a ref as well as in state ──
 *
 * This looks redundant and is not. `toggle` has to know what the task was
 * *before* this tap, synchronously, because that value is the rollback and
 * because the request cannot be sent without knowing which way the tick went.
 *
 * Reading it out of a `setTasks(current => …)` updater does not work. React
 * evaluates an updater eagerly only when the queue for that fiber is empty --
 * it is an optimisation for bailing out of no-op updates -- so the first tap
 * would see its value and every tap after it, while anything was still
 * pending, would see `undefined`. That is precisely the double-tap case this
 * hook exists for, and it fails silently: the box ticks and no request is ever
 * sent. The ref is the synchronous truth; the state exists to render from.
 *
 * ── Why failures are per task too ──
 *
 * `failed` is a map, not a flag. If Hygiene fails to save, the message belongs
 * on the Hygiene row -- one banner at the top saying "something failed" leaves
 * the caregiver to work out which of five ticks did not take, which is exactly
 * the thing they will get wrong.
 */
export default function useOptimisticTasks(initialTasks, persist) {
  const [tasks, setTasks] = useState(initialTasks || []);
  const [pending, setPending] = useState({});   // taskId -> true while in flight
  const [failed, setFailed] = useState({});     // taskId -> message

  /** The list as of right now, readable synchronously. See the note above. */
  const list = useRef(initialTasks || []);

  /*
   * The newest attempt number per task.
   *
   * A reply carrying a stale number is a reply to a tap that has already been
   * superseded; it settles nothing and rolls back nothing.
   */
  const attempts = useRef({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const persistRef = useRef(persist);
  persistRef.current = persist;

  /** Move the list and the render in step. */
  const commit = useCallback((next) => {
    list.current = next;
    setTasks(next);
  }, []);

  /** Set one task's done flag, leaving every other task untouched. */
  const setDone = useCallback((taskId, done) => {
    commit(list.current.map((t) => (t.id === taskId ? { ...t, done } : t)));
  }, [commit]);

  /*
   * Re-sync when the visit is reloaded from the service.
   *
   * Guarded on there being nothing in flight: adopting a fresh server list
   * mid-write would throw away the tick the person just made and make it
   * reappear a moment later when the write confirms.
   */
  useEffect(() => {
    if (!initialTasks) return;
    const anyPending = Object.values(attempts.current).some((a) => a && a.inFlight);
    if (anyPending) return;
    commit(initialTasks);
  }, [initialTasks, commit]);

  const toggle = useCallback(async (taskId) => {
    const task = list.current.find((t) => t.id === taskId);
    // Gone from a list that was reloaded under us.
    if (!task) return;

    const previous = task.done;
    const next = !previous;

    setDone(taskId, next);

    const attempt = ((attempts.current[taskId]?.n) || 0) + 1;
    attempts.current[taskId] = { n: attempt, inFlight: true };

    setPending((p) => ({ ...p, [taskId]: true }));
    setFailed((f) => {
      if (!(taskId in f)) return f;
      const { [taskId]: _gone, ...rest } = f;
      return rest;
    });

    /** Is this reply still the one we are waiting for? */
    const current = () => attempts.current[taskId]?.n === attempt;

    const clearPending = () => setPending((p) => {
      if (!(taskId in p)) return p;
      const { [taskId]: _gone, ...rest } = p;
      return rest;
    });

    try {
      await persistRef.current(taskId, next);
      if (!alive.current || !current()) return;
      attempts.current[taskId].inFlight = false;
      clearPending();
    } catch (err) {
      if (!alive.current || !current()) return;
      attempts.current[taskId].inFlight = false;

      // Roll this one task back to what it was before this tap, and say so on
      // the row itself.
      setDone(taskId, previous);
      clearPending();
      setFailed((f) => ({
        ...f,
        [taskId]: err?.message || 'Could not save that. Tap to try again.',
      }));
    }
  }, [setDone]);

  /** Set the list wholesale -- after a report is filed, or a hard reload. */
  const reset = useCallback((next) => {
    attempts.current = {};
    commit(next || []);
    setPending({});
    setFailed({});
  }, [commit]);

  return {
    tasks,
    toggle,
    reset,
    isPending: (id) => Boolean(pending[id]),
    errorFor: (id) => failed[id] || null,
    doneCount: tasks.filter((t) => t.done).length,
  };
}
