import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { logout } from '../src/commands/logout.js';
import { whoami } from '../src/commands/whoami.js';
import { testCtx } from './helpers/ctx.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('account');
afterAll(() => rmSync(home, { recursive: true, force: true }));
const entry = (environment: 'test' | 'live', keyId: string) => ({
  baseUrl: 'https://api.storeshot.art/v1',
  environment,
  apiKey: `ss_${environment}_${'x'.repeat(32)}`,
  keyId,
  scopes: [],
  createdAt: '2026-11-03T10:00:00.000Z',
});

describe('logout', () => {
  it('forgets the resolved environment only, or both with --all', async () => {
    const a = testCtx(['logout', '--json'], { home });
    a.ctx.store.write(entry('test', 't1'));
    a.ctx.store.write(entry('live', 'l1'));
    expect((await logout(a.ctx)).data).toMatchObject({
      removed: [{ environment: 'test', keyId: 't1' }],
      revokeUrl: 'https://console.storeshot.art/keys',
    });
    expect(a.ctx.store.read('https://api.storeshot.art/v1', 'live')).not.toBeNull();
    const b = testCtx(['logout', '--all'], { home });
    expect((await logout(b.ctx)).data).toMatchObject({
      removed: [{ environment: 'live', keyId: 'l1' }],
    });
    const c = testCtx(['logout'], { home });
    expect((await logout(c.ctx)).human).toEqual(['No stored key to forget.']);
  });
});

describe('whoami', () => {
  it('reports the credential, never the key', async () => {
    const t = testCtx(['whoami'], {
      home,
      env: { STORESHOT_API_KEY: 'ss_test_' + 'w'.repeat(32) },
    });
    t.sdk.me.mockResolvedValue({
      user: { id: 'u1', displayName: 'Dev', avatarUrl: null, createdAt: 'x' },
      credential: {
        type: 'api_key',
        environment: 'test',
        scopes: ['usage:read'],
        apiKey: { id: 'k1', name: 'ci', prefix: 'ss_test_ab', expiresAt: null },
      },
    });
    const r = await whoami(t.ctx);
    expect(r.data).toEqual({
      user: { id: 'u1', displayName: 'Dev', email: null },
      credential: {
        type: 'api_key',
        environment: 'test',
        scopes: ['usage:read'],
        keyId: 'k1',
        keyName: 'ci',
        keyPrefix: 'ss_test_ab',
        expiresAt: null,
      },
      keySource: 'env',
      baseUrl: 'https://api.storeshot.art/v1',
      credentialsFile: null,
    });
  });
});
