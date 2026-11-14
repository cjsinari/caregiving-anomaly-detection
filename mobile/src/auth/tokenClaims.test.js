import { readClaims } from './tokenClaims';

/*
 * Reading the role out of an access token.
 *
 * Small, and worth pinning, because its failure mode is silent: a decoder
 * that returns null for a real token means role changes never take effect,
 * and nothing on screen says why.
 */

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tokenWith = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`;

describe('readClaims', () => {
  it('reads the role and status the service signs into every token', () => {
    const token = tokenWith({ sub: 'u1', role: 'family', status: 'active', sid: 's1' });
    expect(readClaims(token)).toMatchObject({ sub: 'u1', role: 'family', status: 'active' });
  });

  it('copes with base64url characters and missing padding', () => {
    // A payload long and odd enough to need both '-'/'_' and padding repair.
    const token = tokenWith({ role: 'caregiver', note: '>>>???~~~ünïcödé' });
    expect(readClaims(token).role).toBe('caregiver');
    expect(readClaims(token).note).toBe('>>>???~~~ünïcödé');
  });

  it('answers null, not a throw, for anything that is not a JWT', () => {
    // The caller is the session layer mid-refresh; a malformed claim must not
    // fail a refresh that otherwise worked.
    expect(readClaims(undefined)).toBeNull();
    expect(readClaims('')).toBeNull();
    expect(readClaims('opaque-token')).toBeNull();
    expect(readClaims('a.b')).toBeNull();
    expect(readClaims('a.!!!not-base64!!!.c')).toBeNull();
    expect(readClaims(`x.${Buffer.from('not json').toString('base64')}.y`)).toBeNull();
  });
});
