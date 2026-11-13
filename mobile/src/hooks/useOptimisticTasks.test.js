import { act, renderHook, waitFor } from '@testing-library/react-native';
import useOptimisticTasks from './useOptimisticTasks';

/*
 * Acceptance criterion 2 of issue #44, held still.
 *
 * "Completing a task updates the UI immediately (optimistic update with
 * rollback on failure)" is two claims, and the second one is where this gets
 * interesting. A rollback is easy with one task and one tap. The tests that
 * matter are the ones with two taps in flight, because that is the state a
 * five-item checklist spends most of its life in and it is where a naive
 * snapshot-and-restore silently unticks work that saved fine.
 */

const TASKS = [
  { id: 't1', label: 'Medication', done: false },
  { id: 't2', label: 'Meals', done: false },
  { id: 't3', label: 'Hygiene', done: false },
];

/** A persist function whose resolution this test controls. */
function deferred() {
  const calls = [];
  const fn = jest.fn((taskId, done) => new Promise((resolve, reject) => {
    calls.push({ taskId, done, resolve, reject });
  }));
  return {
    fn,
    settle: (taskId, how = 'resolve', value) => {
      const call = calls.find((c) => c.taskId === taskId && !c.settled);
      if (!call) throw new Error(`No pending call for ${taskId}`);
      call.settled = true;
      if (how === 'resolve') call.resolve(value);
      else call.reject(value || new Error('Network unavailable'));
    },
    pendingFor: (taskId) => calls.filter((c) => c.taskId === taskId && !c.settled).length,
  };
}

const done = (result, id) => result.current.tasks.find((t) => t.id === id).done;

describe('the tick lands before the request does', () => {
  it('marks the task done on the tap, not on the reply', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    await act(async () => { result.current.toggle('t1'); });

    // Nothing has been resolved, so this is the optimistic state.
    expect(done(result, 't1')).toBe(true);
    expect(result.current.isPending('t1')).toBe(true);
    expect(api.fn).toHaveBeenCalledWith('t1', true);

    await act(async () => { api.settle('t1'); });

    expect(done(result, 't1')).toBe(true);
    expect(result.current.isPending('t1')).toBe(false);
  });

  it('counts the done tasks as they are ticked', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    expect(result.current.doneCount).toBe(0);
    await act(async () => { result.current.toggle('t1'); });
    await act(async () => { result.current.toggle('t2'); });
    expect(result.current.doneCount).toBe(2);
  });
});

describe('a failed write rolls its own task back', () => {
  it('unticks the task and says why on that row', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    await act(async () => { result.current.toggle('t1'); });
    expect(done(result, 't1')).toBe(true);

    await act(async () => { api.settle('t1', 'reject', new Error('The care service is not responding.')); });

    await waitFor(() => expect(done(result, 't1')).toBe(false));
    expect(result.current.errorFor('t1')).toBe('The care service is not responding.');
    expect(result.current.isPending('t1')).toBe(false);
  });

  it('leaves the other tasks exactly where they were', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    // Three ticks in quick succession, which is how this is actually used.
    await act(async () => { result.current.toggle('t1'); });
    await act(async () => { result.current.toggle('t2'); });
    await act(async () => { result.current.toggle('t3'); });

    await act(async () => {
      api.settle('t1');
      api.settle('t2', 'reject');
      api.settle('t3');
    });

    // Only the middle one comes back. This is the test a snapshot-based
    // rollback fails: it would restore all three to false.
    await waitFor(() => expect(done(result, 't2')).toBe(false));
    expect(done(result, 't1')).toBe(true);
    expect(done(result, 't3')).toBe(true);
    expect(result.current.errorFor('t1')).toBeNull();
    expect(result.current.errorFor('t3')).toBeNull();
  });

  it('clears the error when the row is tapped again', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    await act(async () => { result.current.toggle('t1'); });
    await act(async () => { api.settle('t1', 'reject'); });
    await waitFor(() => expect(result.current.errorFor('t1')).toBeTruthy());

    await act(async () => { result.current.toggle('t1'); });
    expect(result.current.errorFor('t1')).toBeNull();
    expect(done(result, 't1')).toBe(true);
  });
});

describe('two taps on the same task', () => {
  it('settles on the newer one even when the older reply arrives last', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    await act(async () => { result.current.toggle('t1'); });   // -> true
    await act(async () => { result.current.toggle('t1'); });   // -> false

    expect(done(result, 't1')).toBe(false);

    // The second request answers first, then the first one straggles in.
    await act(async () => {
      api.settle('t1');       // the attempt that set it false
      api.settle('t1');       // the stale one that set it true
    });

    // The stale reply must not resurrect the earlier state.
    expect(done(result, 't1')).toBe(false);
  });

  it('does not roll back on a stale failure', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    await act(async () => { result.current.toggle('t1'); });   // attempt 1 -> true
    await act(async () => { result.current.toggle('t1'); });   // attempt 2 -> false

    await act(async () => {
      api.settle('t1', 'reject');   // attempt 1 fails, late
      api.settle('t1');             // attempt 2 succeeds
    });

    // Attempt 1's failure is a reply to a question that was asked again. It
    // neither rolls anything back nor puts an error on the row.
    expect(done(result, 't1')).toBe(false);
    expect(result.current.errorFor('t1')).toBeNull();
  });
});

describe('re-syncing with the service', () => {
  it('adopts a fresh list when nothing is in flight', async () => {
    const api = deferred();
    const { result, rerender } = await renderHook(
      ({ list }) => useOptimisticTasks(list, api.fn),
      { initialProps: { list: TASKS } }
    );

    const fromServer = TASKS.map((t) => ({ ...t, done: true }));
    await act(async () => { rerender({ list: fromServer }); });

    expect(result.current.doneCount).toBe(3);
  });

  it('does not throw away a tick that is still being saved', async () => {
    const api = deferred();
    const { result, rerender } = await renderHook(
      ({ list }) => useOptimisticTasks(list, api.fn),
      { initialProps: { list: TASKS } }
    );

    await act(async () => { result.current.toggle('t1'); });

    // A reload lands mid-write, carrying the pre-tick state.
    await act(async () => { rerender({ list: TASKS.map((t) => ({ ...t })) }); });

    // The tick survives. Letting the stale reload win would make the box
    // visibly un-tick itself and then tick again when the write confirms.
    expect(done(result, 't1')).toBe(true);
  });
});

describe('reset', () => {
  it('drops the list, the errors and the in-flight bookkeeping', async () => {
    const api = deferred();
    const { result } = await renderHook(() => useOptimisticTasks(TASKS, api.fn));

    await act(async () => { result.current.toggle('t1'); });
    await act(async () => { api.settle('t1', 'reject'); });
    await waitFor(() => expect(result.current.errorFor('t1')).toBeTruthy());

    await act(async () => { result.current.reset([{ id: 'x', label: 'New', done: false }]); });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.errorFor('t1')).toBeNull();
    expect(result.current.isPending('t1')).toBe(false);
  });
});
