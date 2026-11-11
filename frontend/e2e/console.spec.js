import { expect, test } from '@playwright/test';
import { waitForOtp } from './service';

/*
 * The journey the milestone asks for: sign in, find a flagged sign-in, resolve
 * it. Against the real service, the real database and the built page.
 *
 * Everything the unit tests stub is real here — the risk engine scoring the
 * sign-in, the OTP, the step-up challenge, the Redis session, the append-only
 * trail. That is the point: the component tests prove the dashboard renders
 * what it is given, and this proves what it is given is what the service
 * actually sends.
 */

const ADMIN_PHONE = '+254799000001';

/*
 * Navigate by the sidebar.
 *
 * Scoped, because several KPI tiles are links to the same destinations and
 * Playwright matches an accessible name by substring: "Anomalies" matched both
 * the nav item and the "Anomalies flagged" tile. Scoping says what the test
 * means — use the navigation — rather than relying on there happening to be one
 * link with that text.
 */
const navigate = (page, label) =>
  page.getByRole('navigation', { name: 'Console sections' })
    .getByRole('link', { name: label, exact: true })
    .click();

/**
 * Sign in, including the step-up leg.
 *
 * The step-up is expected, not an edge case: the seeded administrator has no
 * trusted device, and a browser Playwright launched fresh is a device the risk
 * engine has never seen. Treating it as the normal path is what makes the test
 * reflect a real first sign-in.
 */
async function signIn(page) {
  const requestedAt = Date.now();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MzaziCare' })).toBeVisible();

  await page.getByLabel('Phone number').fill(ADMIN_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();

  const loginCode = await waitForOtp(ADMIN_PHONE, 'login', { after: requestedAt });
  await page.getByLabel('Six-digit code').fill(loginCode);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();

  // Either the console opens, or the risk engine wants a second code first.
  const stepUp = page.getByText('Extra verification');
  const overview = page.getByRole('heading', { name: 'Security overview', level: 1 });

  await expect(stepUp.or(overview)).toBeVisible();

  if (await stepUp.isVisible()) {
    const stepUpAt = Date.now();
    const stepUpCode = await waitForOtp(ADMIN_PHONE, 'step_up', { after: stepUpAt - 30_000 });
    await page.getByLabel('Six-digit code').fill(stepUpCode);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
  }

  await expect(overview).toBeVisible();
}

/*
 * The administrator tests share one sign-in.
 *
 * Not an optimisation — a correctness requirement. The service allows three OTP
 * requests per number per fifteen minutes, and one sign-in through the step-up
 * leg uses two of them, so four tests each signing in would exhaust the budget
 * and the later ones would wait for a code the service had correctly declined
 * to issue. Signing in once is also what an administrator actually does.
 *
 * Serial, with one page shared across the tests, so the session survives
 * between them: the token lives in memory and a fresh page would have none.
 */
test.describe('The security console', () => {
  test.describe.configure({ mode: 'serial' });

  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ extraHTTPHeaders: { 'X-Forwarded-For': '41.90.64.33' } });
    await signIn(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('shows real figures and resolves a flagged sign-in', async () => {

    // ── The overview is populated from the seeded traffic ──
    const logins = page.locator('.tile', { hasText: 'Successful sign-ins' });
    await expect(logins).toBeVisible();
    // A real figure, not a placeholder: the seed put a fortnight of sign-ins in.
    await expect(logins.locator('.tile__value')).not.toHaveText('—');

    await expect(page.getByRole('heading', { name: 'Events over time' })).toBeVisible();
    await expect(page.locator('.legend__item').first()).toBeVisible();

    // ── The anomaly queue ──
    await navigate(page, 'Anomalies');
    await expect(page.getByRole('heading', { name: 'Anomaly review', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Risk score distribution' })).toBeVisible();

    // The seed injects attack bursts that score above the blocking threshold,
    // so the histogram has a right-hand tail and the queue has rows.
    const queue = page.locator('.card', { hasText: 'Review queue' });
    await expect(queue.locator('tbody tr').first()).toBeVisible();

    // ── Examine one, and read the explanation ──
    await queue.getByRole('button', { name: 'Examine' }).first().click();
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();

    // Every flagged event has to carry an explanation a non-technical
    // administrator can follow — the acceptance criterion for the module.
    await expect(detail.getByText('What the service concluded')).toBeVisible();
    const conclusion = detail.locator('.detail-lead');
    await expect(conclusion).toBeVisible();
    expect((await conclusion.textContent()).trim().length).toBeGreaterThan(20);

    // And the signals behind it, with values rather than feature names.
    await expect(detail.getByText('Signals outside their normal range')).toBeVisible();
    await expect(detail.locator('.signal--flagged').first()).toBeVisible();

    // The honesty requirement: not presented as an attribution of the score.
    await expect(detail.getByText(/cannot be attributed to individual features/)).toBeVisible();

    // ── Resolve it ──
    await expect(detail.getByText('Was the service right?')).toBeVisible();
    await detail.getByRole('textbox').first()
      .fill('Phoned the owner; they confirmed the attempts were not theirs.');
    await detail.getByRole('button', { name: /correctly flagged/i }).click();

    // The verdict comes back from the service, not from local state.
    await expect(detail.locator('.verdict__recorded')).toContainText('correctly flagged');

    await detail.getByRole('button', { name: /^Close/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // ── And it is in the audit log, against this administrator ──
    await navigate(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Administrator actions' }).click();

    const trail = page.locator('.card', { hasText: 'Audit log' });
    await expect(trail.getByText('anomaly reviewed').first()).toBeVisible();
    await expect(trail.getByText(/confirmed this sign-in was correctly flagged/).first())
      .toBeVisible();
  });

  test('keeps the period and the filters when moving between views', async () => {
    /*
     * Navigated with a link, not page.goto.
     *
     * goto is a full document load, which discards the in-memory access token
     * and bounces to the login screen — by design, and demonstrated here by
     * accident the first time this test was written. Inside a signed-in session
     * every move has to go through the router, which is also how an
     * administrator actually moves around.
     */
    await navigate(page, 'Overview');
    await expect(page.getByRole('heading', { name: 'Security overview', level: 1 })).toBeVisible();

    // The acceptance criterion: the views share the time range and filters.
    await page.getByRole('button', { name: '7 days' }).click();
    await expect(page).toHaveURL(/window=7d/);

    await navigate(page, 'Security events');
    await expect(page).toHaveURL(/window=7d/);
    await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');

    // A filter set on one view is still set on the next.
    await page.getByRole('combobox').first().selectOption('critical');
    await expect(page).toHaveURL(/severity=critical/);

    await navigate(page, 'Anomalies');
    await expect(page).toHaveURL(/window=7d/);
  });

  test('refuses a non-administrator and does not leave a session behind', async ({ browser }) => {
    const fresh = await browser.newPage({ extraHTTPHeaders: { 'X-Forwarded-For': '41.90.64.33' } });
    /*
     * A seeded family account: a legitimate user of the service who has no
     * business in this console.
     *
     * Not ...002, which the seed deliberately leaves under a temporary lock so
     * the account list has a locked row to render. A locked account is refused
     * at the OTP step and never gets a code, so the test would wait fifteen
     * seconds for something the service was right not to send.
     */
    const familyPhone = '+254799000003';
    const requestedAt = Date.now();

    await fresh.goto('/');
    await fresh.getByLabel('Phone number').fill(familyPhone);
    await fresh.getByRole('button', { name: 'Send code' }).click();

    const code = await waitForOtp(familyPhone, 'login', { after: requestedAt });
    await fresh.getByLabel('Six-digit code').fill(code);
    await fresh.getByRole('button', { name: 'Verify and sign in' }).click();

    const stepUp = fresh.getByText('Extra verification');
    const refusal = fresh.getByText(/console is for administrator accounts/);
    await expect(stepUp.or(refusal)).toBeVisible();

    if (await stepUp.isVisible()) {
      const stepUpCode = await waitForOtp(familyPhone, 'step_up', { after: requestedAt });
      await fresh.getByLabel('Six-digit code').fill(stepUpCode);
      await fresh.getByRole('button', { name: 'Verify and sign in' }).click();
    }

    // Signed in to the service successfully, and still refused this console.
    await expect(refusal).toBeVisible();
    await expect(fresh.getByRole('heading', { name: 'Security overview', level: 1 })).toBeHidden();

    // Back at the number step: the console ended the session it had just
    // created rather than leaving an unused one behind.
    await expect(fresh.getByLabel('Phone number')).toBeVisible();
    await fresh.close();
  });

  test('sends an unauthenticated visitor to the login screen', async ({ browser }) => {
    const anonymous = await browser.newPage();
    const page = anonymous;
    await page.goto('/sessions');
    // The guard redirects rather than rendering an empty shell whose every
    // request comes back 403.
    await expect(page.getByRole('heading', { name: 'MzaziCare' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await anonymous.close();
  });

  test('serves the built page under its content security policy', async () => {
    const violations = [];
    const listener = (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    };
    page.on('console', listener);

    await navigate(page, 'Locations');
    await expect(page.getByRole('heading', { name: 'Sign-in locations', level: 1 })).toBeVisible();

    /*
     * The map is the page most likely to trip the policy — Leaflet loads tiles
     * from a third-party host and sets inline styles on every tile — so it is
     * the one worth visiting to prove img-src and style-src are right.
     */
    expect(violations, `CSP violations:\n${violations.join('\n')}`).toEqual([]);
  });
});
