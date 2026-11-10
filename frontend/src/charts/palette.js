/*
 * Reading the validated palette out of CSS, and assigning it to series.
 *
 * The colours live in tokens.css, where their validation results are recorded
 * alongside them. The charts read the computed custom properties rather than
 * holding a second copy, so a palette change happens in one file and dark mode
 * needs no chart-side branching at all — the same token resolves differently
 * under the dark scope and the chart re-reads it.
 *
 * ── The assignment rule ──
 *
 * Slots are handed out in fixed order and never cycled, because the order is
 * what was measured: adjacent slots were checked for separation under
 * colour-vision deficiency, and slot 9 would be a colour nobody tested. Past
 * eight series, the surplus folds into a single "Other" rather than getting
 * invented hues.
 *
 * Colour follows the entity, not its rank. A series keyed "login_blocked" gets
 * the same slot whether it is the largest band or the smallest, so changing a
 * filter does not repaint the series that survive it — which would otherwise
 * make two screenshots of the same incident look like different incidents.
 */

const SLOT_COUNT = 8;

/** Read a custom property off the document, with a fallback for tests. */
function token(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  return value?.trim() || fallback;
}

/** The categorical slots, in the validated order. */
export function seriesColours() {
  const fallbacks = ['#3a75c4', '#eb6834', '#1baf7a', '#eda100',
                     '#e87ba4', '#008300', '#6250d6', '#e34948'];
  return fallbacks.map((fallback, i) => token(`--series-${i + 1}`, fallback));
}

export function chartInk() {
  return {
    text: token('--text-secondary', '#52514e'),
    muted: token('--text-muted', '#898781'),
    grid: token('--grid', '#e1e0d9'),
    axis: token('--border-strong', '#c3c2b7'),
    surface: token('--surface', '#fcfcfb'),
    good: token('--good', '#0ca30c'),
    warning: token('--warning', '#fab219'),
    serious: token('--serious', '#ec835a'),
    critical: token('--critical', '#d03b3b'),
  };
}

/*
 * Which slot each series key holds, remembered for the session.
 *
 * Sorting the keys and assigning by index is not enough, and getting this
 * wrong is subtle: sorting makes the assignment deterministic for a given SET
 * of series, but the set changes. Filter "login_blocked" out of
 * [login_blocked, login_success, resource_access] and login_success moves from
 * slot 2 to slot 1 — every surviving band changes colour because one was
 * removed. Two screenshots of the same incident then look like two different
 * incidents, and an administrator comparing them has no way to know.
 *
 * So a key keeps the slot it was first given. New keys take the next free slot,
 * in sorted order within a batch so that the first render is deterministic.
 * Removing a series frees nothing and repaints nothing, which is the property
 * that matters: colour follows the entity, never its rank.
 */
const slots = new Map();

export function assignColours(keys) {
  const colours = seriesColours();

  // Sorted, so that a first render with several new keys assigns them in a
  // predictable order rather than in whatever order the service returned.
  for (const key of [...keys].sort()) {
    if (!slots.has(key) && slots.size < SLOT_COUNT) slots.set(key, slots.size);
  }

  const map = new Map();
  for (const key of keys) {
    const slot = slots.get(key);
    if (slot !== undefined) map.set(key, colours[slot]);
  }
  return map;
}

/** For tests, and for a future "reset the palette" control. */
export function resetColourAssignments() {
  slots.clear();
}

/**
 * Fold a series list down to at most eight, with the remainder summed into
 * "Other".
 *
 * Returns the kept series and the keys that were folded, so a chart can say
 * what "Other" contains rather than leaving a band nobody can identify.
 */
export function foldSeries(series, limit = SLOT_COUNT) {
  if (series.length <= limit) return { series, folded: [] };

  const byVolume = [...series].sort((a, b) => (b.total || 0) - (a.total || 0));
  const kept = byVolume.slice(0, limit - 1);
  const folded = byVolume.slice(limit - 1);

  return {
    series: [...kept, {
      key: '__other',
      label: `Other (${folded.length})`,
      total: folded.reduce((sum, s) => sum + (s.total || 0), 0),
    }],
    folded,
  };
}

/** The status colour for a severity, for marks that encode one. */
export function severityColour(severity) {
  const ink = chartInk();
  return {
    info: token('--sev-info', '#6b7a87'),
    medium: ink.warning,
    high: ink.serious,
    critical: ink.critical,
  }[severity] || ink.muted;
}
