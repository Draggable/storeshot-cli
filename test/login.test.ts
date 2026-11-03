import { existsSync, rmSync, statSync } from 'node:fs';
import { StoreshotError } from '@draggable/storeshot-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { login, nextInterval } from '../src/commands/login.js';
import { testCtx } from './helpers/ctx.js';
import { tmpDir } from './helpers/tmp.js';

const made: string[] = [];
const home = () => {
  const d = tmpDir('login');
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const KEY = 'ss_test_' + 'n'.repeat(32);
const START = {
  deviceCode: 'D'.repeat(43),
  userCode: 'BCDF-GHJK',
  verificationUri: 'https://console.storeshot.art/device',
  verificationUriComplete: 'https://console.storeshot.art/device?code=BCDF-GHJK',
  expiresIn: 600,
  interval: 0,
};
const approved = {
  status: 'approved',
  apiKey: KEY,
  keyId: 'key_1',
  scopes: ['generations:write'],
  environment: 'test',
};

describe('login (spec §7.2)', () => {
  it('always sends environment (test by default) and the CLI client name', async () => {
    const t = testCtx(['login', '--json'], { home: home() });
    t.sdk.auth.startDeviceAuthorization.mockResolvedValue(START);
    t.sdk.auth.pollDeviceToken.mockResolvedValue(approved);
    const r = await login(t.ctx);
    expect(t.sdk.auth.startDeviceAuthorization).toHaveBeenCalledWith(
      { clientName: 'Storeshot CLI', environment: 'test' },
      expect.anything(),
    );
    expect(r.data).toMatchObject({
      status: 'linked',
      alreadyLinked: false,
      environment: 'test',
      keyId: 'key_1',
    });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(t.ctx.store.read(t.ctx.config.baseUrl, 'test')?.apiKey).toBe(KEY);
    expect(t.ctx.out.secrets).toContain(KEY);
    expect(t.stderr()).toContain('BCDF-GHJK');
  });
  it('--no-wait stores the pending code (0600) and returns pending; the next login resumes it', async () => {
    const h = home();
    const a = testCtx(['login', '--no-wait'], { home: h });
    a.sdk.auth.startDeviceAuthorization.mockResolvedValue(START);
    const first = await login(a.ctx);
    expect(first.data).toMatchObject({ status: 'pending', userCode: 'BCDF-GHJK' });
    if (process.platform !== 'win32')
      expect(statSync(a.ctx.config.pendingFile).mode & 0o777).toBe(0o600);
    expect(a.sdk.auth.pollDeviceToken).not.toHaveBeenCalled();
    const b = testCtx(['login'], { home: h });
    b.sdk.auth.pollDeviceToken.mockResolvedValue(approved);
    await login(b.ctx);
    expect(b.sdk.auth.startDeviceAuthorization).not.toHaveBeenCalled();
    expect(b.sdk.auth.pollDeviceToken).toHaveBeenCalledWith(START.deviceCode, expect.anything());
    expect(existsSync(b.ctx.config.pendingFile)).toBe(false);
  });
  it('already linked: GET /me ok → no new key', async () => {
    const t = testCtx(['login'], { home: home() });
    t.ctx.store.write({
      baseUrl: t.ctx.config.baseUrl,
      environment: 'test',
      apiKey: KEY,
      keyId: 'key_0',
      scopes: [],
      createdAt: '2026-11-03T10:00:00.000Z',
    });
    t.sdk.me.mockResolvedValue({
      user: { id: 'u' },
      credential: { type: 'api_key', environment: 'test', scopes: [] },
    });
    const r = await login(t.ctx);
    expect(r.data).toMatchObject({ status: 'linked', alreadyLinked: true, keyId: 'key_0' });
    expect(t.sdk.auth.startDeviceAuthorization).not.toHaveBeenCalled();
  });
  it('a stored key answering 401 is forgotten and a new flow starts', async () => {
    const t = testCtx(['login'], { home: home() });
    t.ctx.store.write({
      baseUrl: t.ctx.config.baseUrl,
      environment: 'test',
      apiKey: 'ss_test_' + 'o'.repeat(32),
      keyId: 'old',
      scopes: [],
      createdAt: '2026-11-03T10:00:00.000Z',
    });
    t.sdk.me.mockRejectedValue(
      new StoreshotError({ code: 'UNAUTHORIZED', message: 'no', status: 401 }),
    );
    t.sdk.auth.startDeviceAuthorization.mockResolvedValue(START);
    t.sdk.auth.pollDeviceToken.mockResolvedValue(approved);
    const r = await login(t.ctx);
    expect(r.data).toMatchObject({ keyId: 'key_1', alreadyLinked: false });
  });
  it('denied or expired deletes the pending code and throws the SDK code', async () => {
    const t = testCtx(['login'], { home: home() });
    t.sdk.auth.startDeviceAuthorization.mockResolvedValue(START);
    t.sdk.auth.pollDeviceToken.mockRejectedValue(
      new StoreshotError({ code: 'DEVICE_ACCESS_DENIED', message: 'denied', status: 400 }),
    );
    await expect(login(t.ctx)).rejects.toMatchObject({ code: 'DEVICE_ACCESS_DENIED' });
    expect(existsSync(t.ctx.config.pendingFile)).toBe(false);
  });
  it('refuses when a key is given explicitly (nothing is stored)', async () => {
    const t = testCtx(['login'], { home: home(), env: { STORESHOT_API_KEY: KEY } });
    await expect(login(t.ctx)).rejects.toMatchObject({ code: 'USAGE' });
  });
  it('--env live asks for a live key', async () => {
    const t = testCtx(['login', '--env', 'live'], { home: home() });
    t.sdk.auth.startDeviceAuthorization.mockResolvedValue(START);
    t.sdk.auth.pollDeviceToken.mockResolvedValue({
      ...approved,
      environment: 'live',
      apiKey: 'ss_live_' + 'n'.repeat(32),
    });
    await login(t.ctx);
    expect(t.sdk.auth.startDeviceAuthorization.mock.calls[0][0]).toEqual({
      clientName: 'Storeshot CLI',
      environment: 'live',
    });
  });
});

describe('nextInterval (RFC 8628 §3.5, same rule as the SDK)', () => {
  it('pending keeps the interval; slow_down adds 5 and honours Retry-After', () => {
    expect(nextInterval({ interval: 5, wait: 5 }, { status: 'authorization_pending' })).toEqual({
      interval: 5,
      wait: 5,
    });
    expect(
      nextInterval({ interval: 5, wait: 5 }, { status: 'slow_down', retryAfterSeconds: null }),
    ).toEqual({ interval: 10, wait: 10 });
    expect(
      nextInterval({ interval: 10, wait: 10 }, { status: 'slow_down', retryAfterSeconds: 30 }),
    ).toEqual({ interval: 15, wait: 30 });
  });
});
