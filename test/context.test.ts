import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { keyed } from '../src/context.js';
import { testCtx } from './helpers/ctx.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('ctx');
afterAll(() => rmSync(home, { recursive: true, force: true }));
const TEST = 'ss_test_' + 'a'.repeat(32);
const STORED = 'ss_test_' + 's'.repeat(32);

describe('keyed()', () => {
  it('uses the explicit key and records its source', async () => {
    const t = testCtx(['credits'], { home, env: { STORESHOT_API_KEY: TEST } });
    await keyed(t.ctx);
    expect(t.keys).toEqual([TEST]);
    expect(t.ctx.keySource).toBe('env');
    expect(t.ctx.keyEnvironment).toBe('test');
    expect(t.ctx.out.secrets).toContain(TEST);
  });
  it('falls back to the stored key of the resolved environment', async () => {
    const t = testCtx(['credits'], { home });
    t.ctx.store.write({
      baseUrl: t.ctx.config.baseUrl,
      environment: 'test',
      apiKey: STORED,
      keyId: 'k1',
      scopes: [],
      createdAt: '2026-11-03T10:00:00.000Z',
    });
    await keyed(t.ctx);
    expect(t.keys).toEqual([STORED]);
    expect(t.ctx).toMatchObject({ keySource: 'stored', keyEnvironment: 'test', keyId: 'k1' });
  });
  it('never uses a stored live key without --env live (test by default)', async () => {
    const t = testCtx(['credits'], { home: tmpDir('ctx-live') });
    t.ctx.store.write({
      baseUrl: t.ctx.config.baseUrl,
      environment: 'live',
      apiKey: 'ss_live_' + 'l'.repeat(32),
      keyId: 'k2',
      scopes: [],
      createdAt: '2026-11-03T10:00:00.000Z',
    });
    await expect(keyed(t.ctx)).rejects.toMatchObject({ code: 'NOT_LOGGED_IN' });
  });
  it('builds the client once', async () => {
    const t = testCtx(['credits'], { home, env: { STORESHOT_API_KEY: TEST } });
    await keyed(t.ctx);
    await keyed(t.ctx);
    expect(t.keys).toHaveLength(1);
  });
});

describe('createCtx (SS-023)', () => {
  it('carries the environment and no interrupt note by default', () => {
    const t = testCtx(['credits'], { home, env: { PATH: '/bin' } });
    expect(t.ctx.env.PATH).toBe('/bin');
    expect(t.ctx.interrupt).toBeNull();
  });
});
