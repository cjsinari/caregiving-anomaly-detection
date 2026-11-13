import { family } from './family';
import { __resetCareApiForTests } from './careSource';
import { api, ApiError } from './client';
import { mockFamilyApi, mockFamilyControls } from './mock/familyData';
import { mockCaregiverApi, mockControls as caregiverMockControls } from './mock/caregiverData';
import * as session from '../auth/session';

/*
 * The family data layer.
 *
 * Three claims worth holding still:
 *
 *   - It cannot write care data. Not "the screens do not", but "there is no
 *     function to call". The issue says family members must not be able to
 *     edit care data, and the cheapest guarantee is an API with no verb for it.
 *   - Account security notices survive the care service failing, and the
 *     reverse. Losing "somebody signed into your account" because a care
 *     endpoint was slow is the failure this screen must never have.
 *   - The mocks refuse the wrong role, as the service does, so a portal
 *     mix-up is caught before the real care module exists to catch it.
 */

jest.mock('./client', () => {
  const actual = jest.requireActual('./client');
  return {
    ...actual,
    api: { authed: { get: jest.fn(), post: jest.fn(), delete: jest.fn() }, get: jest.fn(), post: jest.fn() },
  };
});

jest.mock('../auth/session', () => {
  const actual = jest.requireActual('../auth/session');
  return { ...actual, getStoredUser: jest.fn(() => null) };
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetCareApiForTests('mock');
  mockFamilyControls.reset();
  mockFamilyControls.latencyMs = 0;
  session.getStoredUser.mockReturnValue(null);
});

describe('read-only by construction', () => {
  it('offers nothing that could change a care record', () => {
    // If this list grows, the new function had better not write care data.
    expect(Object.keys(family).sort()).toEqual([
      'markNotificationsRead',
      'notifications',
      'overview',
      'recipient',
      'recipients',
      'schedule',
      'updates',
    ]);
  });

  it('sends no write to the service while the portal is used', async () => {
    __resetCareApiForTests('live');
    api.authed.get.mockImplementation(async (path) => {
      if (path === '/family/recipients') return { recipients: [{ id: 'r1', fullName: 'A' }] };
      if (path.endsWith('/overview')) return { recipient: { id: 'r1' }, latestUpdates: [] };
      if (path.includes('/updates')) return { items: [], nextCursor: null };
      if (path.endsWith('/schedule')) return { visits: [] };
      if (path === '/auth/notifications') return { notifications: [] };
      if (path === '/family/notifications') return { notifications: [] };
      return { recipient: { id: 'r1', caregivers: [] } };
    });

    await family.recipients();
    await family.overview('r1');
    await family.updates({ recipientId: 'r1' });
    await family.recipient('r1');
    await family.schedule('r1');
    await family.notifications();

    expect(api.authed.post).not.toHaveBeenCalled();
    expect(api.authed.delete).not.toHaveBeenCalled();
  });
});

describe('notifications', () => {
  beforeEach(() => {
    api.authed.get.mockImplementation(async (path) => {
      if (path === '/auth/notifications') {
        return {
          unread: 1,
          notifications: [{
            id: 7,
            type: 'new_device_trusted',
            severity: 'medium',
            message: 'MzaziCare: a new device was verified and added to your account.',
            createdAt: new Date().toISOString(),
            readAt: null,
          }],
        };
      }
      throw new ApiError('Not Found', { status: 404 });
    });
  });

  it('merges care and account notices, newest first', async () => {
    const { items, partial } = await family.notifications();

    expect(partial).toBeNull();
    expect(items[0]).toMatchObject({
      id: 'account-7',
      category: 'account',
      title: 'New device added',
      // The SMS brand prefix is noise inside the app.
      message: 'a new device was verified and added to your account.',
    });
    expect(items.some((n) => n.category === 'incident')).toBe(true);
    const times = items.map((n) => new Date(n.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('always reads account notices from the real service, even in mock mode', async () => {
    await family.notifications();
    expect(api.authed.get).toHaveBeenCalledWith('/auth/notifications');
  });

  it('still shows care notifications when the account notices fail', async () => {
    api.authed.get.mockRejectedValue(new ApiError('Could not reach LindaCare.', { code: 'NETWORK' }));

    const { items, partial } = await family.notifications();

    expect(partial).toBe('account');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((n) => n.category !== 'account')).toBe(true);
  });

  it('still shows account notices when the care service fails', async () => {
    mockFamilyControls.failFor(1);

    const { items, partial } = await family.notifications();

    // The one that must never be lost to a slow care endpoint.
    expect(partial).toBe('care');
    expect(items.map((n) => n.id)).toEqual(['account-7']);
  });

  it('fails outright only when both halves fail', async () => {
    mockFamilyControls.failFor(1);
    api.authed.get.mockRejectedValue(new ApiError('Offline', { code: 'NETWORK' }));

    await expect(family.notifications()).rejects.toThrow();
  });

  it('marks both halves read', async () => {
    api.authed.post.mockResolvedValue({ updated: 1 });

    await family.markNotificationsRead();

    expect(api.authed.post).toHaveBeenCalledWith('/auth/notifications/read', {});
    expect(mockFamilyControls.snapshot().notifications.every((n) => n.readAt)).toBe(true);
  });
});

describe('live mode', () => {
  beforeEach(() => __resetCareApiForTests('live'));

  it('pages the feed with an opaque cursor and a filter', async () => {
    api.authed.get.mockResolvedValue({ items: [], nextCursor: null });

    await family.updates({ recipientId: 'r1', cursor: 'abc', limit: 10, kind: 'incident' });

    const url = api.authed.get.mock.calls[0][0];
    expect(url).toMatch(/^\/family\/recipients\/r1\/updates\?/);
    expect(url).toContain('cursor=abc');
    expect(url).toContain('kind=incident');
    expect(url).toContain('limit=10');
  });

  it('reads a snake_case care team', async () => {
    api.authed.get.mockResolvedValue({
      recipient: {
        id: 'r1',
        caregivers: [{ id: 'c1', full_name: 'Grace Wanjiru', phone_number: '+254700000201', is_primary: true }],
      },
    });

    const r = await family.recipient('r1');

    expect(r.caregivers[0]).toMatchObject({
      fullName: 'Grace Wanjiru', phone: '+254700000201', isPrimary: true,
    });
  });
});

describe('the mock refuses the wrong role, as the service does', () => {
  it('turns a caregiver session away from family data', async () => {
    session.getStoredUser.mockReturnValue({ id: 'u', role: 'caregiver' });

    await expect(mockFamilyApi.recipients()).rejects.toMatchObject({ status: 403, code: 'ROLE_FORBIDDEN' });
  });

  it('turns a family session away from caregiver data', async () => {
    session.getStoredUser.mockReturnValue({ id: 'u', role: 'family' });
    caregiverMockControls.latencyMs = 0;

    await expect(mockCaregiverApi.assignments()).rejects.toMatchObject({ status: 403, code: 'ROLE_FORBIDDEN' });
  });

  it('serves a family session', async () => {
    session.getStoredUser.mockReturnValue({ id: 'u', role: 'family' });

    const { recipients } = await mockFamilyApi.recipients();
    expect(recipients.length).toBeGreaterThan(0);
  });
});

describe('the mock feed pages honestly', () => {
  it('serves several pages, then stops', async () => {
    const pages = [];
    let cursor = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await mockFamilyApi.updates({ recipientId: 'rec-001', cursor, limit: 10 });
      pages.push(page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(pages.length).toBeGreaterThan(2);
    const ids = pages.flat().map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not repeat an item when one is filed between pages', async () => {
    const first = await mockFamilyApi.updates({ recipientId: 'rec-001', limit: 10 });
    mockFamilyControls.addUpdate('rec-001', { kind: 'visit', title: 'Just filed', body: 'x' });
    const second = await mockFamilyApi.updates({ recipientId: 'rec-001', cursor: first.nextCursor, limit: 10 });

    // An offset cursor would start page two on the item page one ended with.
    const overlap = second.items.filter((u) => first.items.some((f) => f.id === u.id));
    expect(overlap).toHaveLength(0);
  });

  it('answers an unlinked loved one as not found, not forbidden', async () => {
    // Forbidden would confirm the profile exists.
    await expect(mockFamilyApi.recipient('rec-999')).rejects.toMatchObject({ status: 404 });
  });
});
