import Constants from 'expo-constants';
import { api, ApiError } from './client';

/*
 * The one decision about where care data comes from, shared by both portals.
 *
 * ── The problem this file solves ──
 *
 * `auth-service` has care profiles and assignments, scoped at the database to
 * whoever is asking (resourceAccess.js). It has no visits, no tasks, no care
 * notes, no incident reports and no care updates feed: there is no care
 * module yet. The caregiver screens (#44) and the family screens (#45) both
 * need all of those.
 *
 * Building against the service alone means screens with nothing in them.
 * Building half against the service and half against a fixture means a screen
 * where the name is real and the visit count is invented, and no way to tell
 * which is which when something looks wrong. So all care data reads from *one*
 * source, chosen once per app run, and the mocks answer in exactly the shapes
 * the care module is specified to answer in. When it lands, the API files
 * change and the screens never learn which source they were reading.
 *
 * ── Why the decision lives here rather than in each portal ──
 *
 * It was in caregiver.js while there was one portal. With two, each would
 * otherwise probe separately and could in principle reach different answers
 * about the same service. It is one service; it gets one answer.
 *
 * ── How the source is chosen ──
 *
 *   app.json → expo.extra.careApi
 *     'auto'  (default) probe the service once; fall back to the mock if the
 *             care module is not mounted.
 *     'mock'  never call the service. What a demo or a laptop with no
 *             database runs on.
 *     'live'  never fall back. What CI runs on once the module exists, so a
 *             broken endpoint fails loudly instead of being papered over by a
 *             fixture that always works.
 *
 * The probe is one request and its result is remembered, so this costs a
 * single 404 on the first screen and nothing afterwards.
 */

const CONFIGURED_MODE = String(Constants.expoConfig?.extra?.careApi || 'auto').toLowerCase();

/** The mode in force. Only a test ever changes it; see __resetCareApiForTests. */
let mode = CONFIGURED_MODE;

const startingSource = () => (mode === 'mock' ? 'mock' : mode === 'live' ? 'live' : null);

/** Resolved on the first call: 'live' or 'mock'. */
let resolvedSource = startingSource();
let probeInFlight = null;

/** What the app is actually reading. */
export function careApiSource() {
  return resolvedSource || 'unresolved';
}

/**
 * Test seam: put the module back to a known mode.
 *
 * It sets the *mode*, not just the resolved source, because the two are not
 * the same decision -- 'live' has to disable the per-route fallback as well as
 * the probe, and a seam that set only the source would leave a pinned-live app
 * quietly answering a 404 with fixture data.
 */
export function __resetCareApiForTests(override) {
  mode = override || CONFIGURED_MODE;
  resolvedSource = startingSource();
  probeInFlight = null;
}

const notMounted = (err) =>
  err instanceof ApiError && (err.status === 404 || err.status === 501);

/*
 * Does the service have a care module?
 *
 * A 404 or a 501 is the answer "not mounted", and is the whole point of the
 * probe. Anything else -- a 500, a timeout, a dead network -- is *not*: the
 * module may well be there and simply having a bad minute, and silently
 * swapping someone onto fixture data at that moment would show a caregiver
 * invented patients, or a family member a visit that never happened. That is
 * a worse failure than an error message, so it stays live and the error
 * surfaces.
 */
async function probe() {
  try {
    await api.authed.get('/care/health');
    return 'live';
  } catch (err) {
    if (notMounted(err)) {
      if (__DEV__) {
        console.info(
          '[care] No care module on the service (404). Falling back to the mock dataset. '
          + "Set expo.extra.careApi to 'live' in app.json to turn this off."
        );
      }
      return 'mock';
    }
    throw err;
  }
}

async function source() {
  if (resolvedSource) return resolvedSource;
  if (!probeInFlight) {
    probeInFlight = probe()
      .then((value) => { resolvedSource = value; return value; })
      .finally(() => { probeInFlight = null; });
  }
  return probeInFlight;
}

/**
 * Run `live` or `mock`, whichever this app run is using.
 *
 * In 'auto' a live call that comes back 404 flips the source permanently and
 * retries against the mock, which covers the case where /care/health exists
 * but an individual route has not been written yet.
 */
export async function route(live, mock) {
  const which = await source();
  if (which === 'mock') return mock();

  try {
    return await live();
  } catch (err) {
    if (mode === 'auto' && notMounted(err)) {
      resolvedSource = 'mock';
      return mock();
    }
    throw err;
  }
}
