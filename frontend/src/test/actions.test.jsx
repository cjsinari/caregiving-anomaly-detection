import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures, renderPage, stubFetch, streamStub } from './harness';

/*
 * The response actions, the account views and the audit log viewer.
 *
 * What these check, beyond "it renders": that a destructive action cannot be
 * taken without a stated reason, that the dialog tells the administrator what
 * the action costs the person affected, and that the audit viewer offers no way
 * to alter what it shows.
 */

beforeEach(() => {
  stubFetch([streamStub().route]);
  return import('../api/client').then(({ setTokens }) =>
    setTokens({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token-0123456789abcdef0123456789abcdef' }));
});

/** The account-detail payload, which has no fixture of its own. */
const accountDetail = {
  account: {
    id: '0a111111-1111-1111-1111-111111111111',
    fullName: 'Grace Wanjiku',
    role: 'family',
    accountStatus: 'active',
    phoneNumber: '+2547****1234',
    phoneVerified: true,
    verificationStatus: 'verified',
    createdAt: '2026-06-01T10:00:00.000Z',
    lockedUntil: null,
    lastLogin: { at: '2026-11-10T16:00:00.000Z', country: 'KE', city: 'Nairobi' },
    events: 24,
    urgentEvents: 3,
    activeSessions: 1,
    email: null,
    backupEmail: null,
    consentAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-11-10T16:00:00.000Z',
  },
  riskSummary: {
    periodDays: 90, scored: 15, blocked: 1, steppedUp: 3,
    falsePositives: 2, truePositives: 1,
    averageScore: 22.4, highestScore: 92.4, countriesSeen: 2, failedAttempts: 4,
  },
  sessions: [{
    id: '0b111111-1111-1111-1111-111111111111',
    status: 'active',
    device: { fingerprint: 'device-abc', ip: '41.90.64.33', lastSeenIp: null },
    startedAt: '2026-11-10T16:00:00.000Z',
    lastSeenAt: null,
    expiresAt: '2026-11-17T16:00:00.000Z',
    riskScore: 3.2,
    cache: { cached: true },
  }],
  trustedDevices: [
    { id: 'd1', label: 'Grace phone', trustedAt: '2026-06-01T10:05:00.000Z', lastSeenAt: '2026-11-10T16:00:00.000Z' },
  ],
  history: fixtures.events.events.map((e) => ({ ...e, layer: 'pre_login' })),
};

const accountRoutes = [
  [/\/admin\/accounts\/[0-9a-f-]+$/, () => accountDetail],
  [/\/admin\/accounts/, () => ({ total: 2, limit: 100, offset: 0, accounts: [
    { ...accountDetail.account, id: '0a111111-1111-1111-1111-111111111111' },
    {
      id: '0a222222-2222-2222-2222-222222222222', fullName: 'Mary Wanjiru', role: 'caregiver',
      accountStatus: 'frozen', phoneNumber: '+2547****5678', phoneVerified: true,
      verificationStatus: 'unverified', createdAt: '2026-07-01T10:00:00.000Z',
      lockedUntil: null, lastLogin: null, events: 9, urgentEvents: 0, activeSessions: 0,
    },
  ] })],
];

describe('Accounts', () => {
  it('lists accounts with standing, last sign-in and activity', async () => {
    const UsersPage = (await import('../pages/UsersPage')).default;
    stubFetch([streamStub().route, ...accountRoutes]);
    await renderPage(<UsersPage />, { path: '/users' });

    await waitFor(() => expect(screen.getByText('Accounts')).toBeInTheDocument());

    const row = screen.getByText('Mary Wanjiru').closest('tr');
    expect(within(row).getByText('Frozen')).toBeInTheDocument();
    expect(within(row).getByText('never')).toBeInTheDocument();
  });

  it('shows a lock beside the standing, not instead of it', async () => {
    const UsersPage = (await import('../pages/UsersPage')).default;
    stubFetch([
      streamStub().route,
      [/\/admin\/accounts/, () => ({ total: 1, limit: 100, offset: 0, accounts: [{
        ...accountDetail.account,
        accountStatus: 'active',
        lockedUntil: new Date(Date.now() + 3600_000).toISOString(),
      }] })],
    ]);
    await renderPage(<UsersPage />, { path: '/users' });

    await waitFor(() => expect(screen.getByText('Accounts')).toBeInTheDocument());

    // A lock expires on its own, so it is not a standing; both must be visible.
    const row = screen.getByText('Grace Wanjiku').closest('tr');
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).getByText('Locked')).toBeInTheDocument();
  });

  it('shows the risk summary and the review history in the detail', async () => {
    const UsersPage = (await import('../pages/UsersPage')).default;
    stubFetch([streamStub().route, ...accountRoutes]);
    await renderPage(<UsersPage />, { path: '/users?userId=0a111111-1111-1111-1111-111111111111' });

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/Risk summary/)).toBeInTheDocument());

    expect(within(dialog).getByText('1 correct, 2 wrong')).toBeInTheDocument();
    // Two earlier flags on this account were wrong, which is worth weighing
    // before acting on a third.
    expect(within(dialog).getByText(/reviewed and found to\s+be wrong/)).toBeInTheDocument();
  });

  it('offers the four responses, least severe first', async () => {
    const UsersPage = (await import('../pages/UsersPage')).default;
    stubFetch([streamStub().route, ...accountRoutes]);
    await renderPage(<UsersPage />, { path: '/users?userId=0a111111-1111-1111-1111-111111111111' });

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Response')).toBeInTheDocument());

    const buttons = within(dialog).getByText('Response').closest('section')
      .querySelectorAll('.actions .btn');
    expect([...buttons].map((b) => b.textContent)).toEqual([
      'Require extra verification', 'Lock temporarily', 'Freeze account',
    ]);
  });

  it('offers restore instead of freeze for a frozen account', async () => {
    const UsersPage = (await import('../pages/UsersPage')).default;
    stubFetch([
      streamStub().route,
      [/\/admin\/accounts\/[0-9a-f-]+$/, () => ({
        ...accountDetail,
        account: { ...accountDetail.account, accountStatus: 'frozen' },
      })],
      ...accountRoutes,
    ]);
    await renderPage(<UsersPage />, { path: '/users?userId=0a111111-1111-1111-1111-111111111111' });

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Response')).toBeInTheDocument());

    expect(within(dialog).getByRole('button', { name: /restore access/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^freeze account$/i })).not.toBeInTheDocument();
  });
});

describe('Confirming a destructive action', () => {
  async function openFreezeDialog() {
    const UsersPage = (await import('../pages/UsersPage')).default;
    const stub = stubFetch([streamStub().route, ...accountRoutes]);
    await renderPage(<UsersPage />, { path: '/users?userId=0a111111-1111-1111-1111-111111111111' });

    const detail = await screen.findByRole('dialog');
    await waitFor(() => expect(within(detail).getByText('Response')).toBeInTheDocument());
    await userEvent.click(within(detail).getByRole('button', { name: /^freeze account$/i }));

    return { stub, dialog: await screen.findByRole('dialog', { name: /freeze this account/i }) };
  }

  it('states what the action costs the person affected', async () => {
    const { dialog } = await openFreezeDialog();

    expect(within(dialog).getByText(/signed out of every device/)).toBeInTheDocument();
    expect(within(dialog).getByText(/notified by SMS/)).toBeInTheDocument();
    // And points at the lesser action, because the instinct at 2am is to reach
    // for the biggest lever.
    expect(within(dialog).getByText(/a temporary lock does/)).toBeInTheDocument();
  });

  it('will not submit without a reason', async () => {
    const { stub, dialog } = await openFreezeDialog();

    const submit = within(dialog).getByRole('button', { name: /freeze account/i });
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByRole('textbox'), 'four');
    expect(submit).toBeDisabled();           // under five characters

    await userEvent.type(within(dialog).getByRole('textbox'), ' characters and more');
    expect(submit).toBeEnabled();

    // Nothing was sent while the reason was too short.
    expect(stub.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
  });

  it('sends the reason with the action', async () => {
    const { stub, dialog } = await openFreezeDialog();

    await userEvent.type(within(dialog).getByRole('textbox'),
      'Three impossible-travel events in one hour; owner unreachable.');
    await userEvent.click(within(dialog).getByRole('button', { name: /freeze account/i }));

    await waitFor(() => {
      const post = stub.mock.calls.find(([url, o]) =>
        o?.method === 'POST' && String(url).includes('/freeze'));
      expect(post).toBeDefined();
      expect(JSON.parse(post[1].body).reason).toContain('impossible-travel');
    });
  });

  it('stays open and keeps the typed reason when the service refuses', async () => {
    const UsersPage = (await import('../pages/UsersPage')).default;
    stubFetch([
      streamStub().route,
      [/\/freeze$/, () => ({ status: 409, body: { error: 'That account is already frozen.', code: 'ALREADY_FROZEN' } })],
      ...accountRoutes,
    ]);
    await renderPage(<UsersPage />, { path: '/users?userId=0a111111-1111-1111-1111-111111111111' });

    const detail = await screen.findByRole('dialog');
    await waitFor(() => expect(within(detail).getByText('Response')).toBeInTheDocument());
    await userEvent.click(within(detail).getByRole('button', { name: /^freeze account$/i }));

    const dialog = await screen.findByRole('dialog', { name: /freeze this account/i });
    await userEvent.type(within(dialog).getByRole('textbox'), 'A reason worth keeping');
    await userEvent.click(within(dialog).getByRole('button', { name: /freeze account/i }));

    // The action did not happen, so the administrator should not have to retype.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already frozen/));
    expect(within(dialog).getByRole('textbox')).toHaveValue('A reason worth keeping');
  });

  it('closes on Escape without acting', async () => {
    const { stub, dialog } = await openFreezeDialog();
    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /freeze this account/i })).not.toBeInTheDocument());
    expect(stub.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
  });
});

describe('Anomaly review', () => {
  it('asks whether the service was right, in those words', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(screen.getByText('Review queue')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /examine/i }));

    const dialog = await screen.findByRole('dialog');
    // Not "true positive / false positive": that vocabulary means nothing to
    // someone who has not read the training script.
    expect(within(dialog).getByText('Was the service right?')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /correctly flagged/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /false alarm/i })).toBeInTheDocument();
  });

  it('records the verdict in the vocabulary a retrain needs', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    const stub = stubFetch([
      streamStub().route,
      [/\/admin\/anomalies\/[0-9a-f-]+$/, () => ({
        message: 'Review recorded.',
        anomaly: {
          id: fixtures.anomalies.anomalies[0].id,
          reviewStatus: 'false_positive',
          reviewNote: 'Phoned the owner; they were travelling.',
          reviewedAt: '2026-11-10T17:00:00.000Z',
        },
      })],
    ]);
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(screen.getByText('Review queue')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /examine/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'),
      'Phoned the owner; they were travelling.');
    await userEvent.click(within(dialog).getByRole('button', { name: /false alarm/i }));

    await waitFor(() => {
      const patch = stub.mock.calls.find(([, o]) => o?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(patch[1].body);
      expect(body.reviewStatus).toBe('false_positive');
      expect(body.note).toContain('travelling');
    });

    // And the panel says what was recorded, so it is not ambiguous afterwards.
    await waitFor(() =>
      expect(within(dialog).getByText(/wrongly flagged/)).toBeInTheDocument());
  });

  it('distinguishes an unreviewed flag from one found to be fine', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    stubFetch([
      streamStub().route,
      [/\/admin\/anomalies(\?|$)/, () => ({
        ...fixtures.anomalies,
        anomalies: [{
          ...fixtures.anomalies.anomalies[0],
          review: {
            status: 'true_positive',
            note: 'Confirmed with the owner.',
            at: '2026-11-10T17:00:00.000Z',
            by: { id: 'u3', fullName: 'Ops Administrator' },
          },
        }],
      })],
    ]);
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(screen.getByText('Review queue')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /examine/i }));

    const dialog = await screen.findByRole('dialog');
    // Scoped to the recorded-verdict panel: "correctly flagged" is deliberately
    // also the wording on the button that records it.
    const recorded = dialog.querySelector('.verdict__recorded');
    expect(recorded).not.toBeNull();
    expect(recorded).toHaveTextContent(/Recorded as/);
    expect(recorded).toHaveTextContent(/correctly flagged/);
    expect(recorded).toHaveTextContent(/Ops Administrator/);
    expect(recorded).toHaveTextContent(/Confirmed with the owner/);
  });
});

describe('Sessions', () => {
  it('reports whether the cache still holds each session', async () => {
    const SessionsPage = (await import('../pages/SessionsPage')).default;
    await renderPage(<SessionsPage />, { path: '/sessions' });

    await waitFor(() => expect(screen.getByText('Sessions')).toBeInTheDocument());

    // How an administrator knows a revoke took effect everywhere, not just in
    // the database.
    expect(screen.getByText('held')).toBeInTheDocument();
    expect(screen.getByText(/Ending a session takes effect immediately/)).toBeInTheDocument();
  });

  it('says a session block does not touch the account', async () => {
    const SessionsPage = (await import('../pages/SessionsPage')).default;
    await renderPage(<SessionsPage />, { path: '/sessions' });

    await waitFor(() => expect(screen.getByText('Sessions')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /end session/i }));

    const dialog = await screen.findByRole('dialog', { name: /end this session/i });
    expect(within(dialog).getByText(/account is not changed/)).toBeInTheDocument();
    expect(within(dialog).getByText(/can sign in again straight away/)).toBeInTheDocument();
  });
});

describe('Audit log viewer', () => {
  it('offers no way to change what it shows', async () => {
    const AuditLogPage = (await import('../pages/AuditLogPage')).default;
    await renderPage(<AuditLogPage />, { path: '/audit' });

    await waitFor(() => expect(screen.getByText('Audit log')).toBeInTheDocument());

    const buttons = screen.getAllByRole('button').map((b) => b.textContent.toLowerCase());
    expect(buttons.some((label) => /delete|remove|edit|amend/.test(label))).toBe(false);
  });

  it('explains that the table itself refuses an edit', async () => {
    const AuditLogPage = (await import('../pages/AuditLogPage')).default;
    await renderPage(<AuditLogPage />, { path: '/audit' });

    await waitFor(() => expect(screen.getByText('Audit log')).toBeInTheDocument());

    // Not "we hid the buttons" — the guarantee is at the database.
    expect(screen.getByText(/database trigger rejects every delete/)).toBeInTheDocument();
    expect(screen.getByText(/cannot erase the record of their own action/)).toBeInTheDocument();
  });

  it('can narrow to administrator actions', async () => {
    const AuditLogPage = (await import('../pages/AuditLogPage')).default;
    const stub = stubFetch([streamStub().route]);
    await renderPage(<AuditLogPage />, { path: '/audit' });

    await waitFor(() => expect(screen.getByText('Audit log')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Administrator actions' }));

    await waitFor(() => {
      const call = stub.mock.calls.map(([url]) => String(url))
        .reverse().find((u) => u.includes('/admin/events?'));
      expect(call).toContain('actorType=administrator');
    });
  });

  it('records the export, and says so on the control', async () => {
    const AuditLogPage = (await import('../pages/AuditLogPage')).default;
    await renderPage(<AuditLogPage />, { path: '/audit' });

    await waitFor(() => expect(screen.getByText('Audit log')).toBeInTheDocument());

    const exportButton = screen.getByRole('button', { name: /export csv/i });
    expect(exportButton).toHaveAttribute('title', expect.stringContaining('recorded in the audit log'));
    expect(screen.getByText(/Exporting is recorded here too/)).toBeInTheDocument();
  });
});
