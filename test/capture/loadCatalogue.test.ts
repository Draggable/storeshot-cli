import { rmSync } from 'node:fs';
import { StoreshotError } from '@draggable/storeshot-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { BUNDLED_DEVICES } from '../../src/capture/catalogue.js';
import { loadCatalogue } from '../../src/capture/loadCatalogue.js';
import { testCtx } from '../helpers/ctx.js';
import { tmpDir } from '../helpers/tmp.js';

const home = tmpDir('catalogue');
afterAll(() => rmSync(home, { recursive: true, force: true }));
const KEY = { STORESHOT_API_KEY: 'ss_test_' + 'k'.repeat(32) };
const API = [{ ...BUNDLED_DEVICES[0], label: 'From the API' }];

describe('loadCatalogue (spec §6.1)', () => {
  it('a key at hand: the API, 5 s, no retry', async () => {
    const t = testCtx(['capture', 'ios'], { home, env: KEY });
    t.sdk.devices.list.mockResolvedValue({ data: API });
    expect(await loadCatalogue(t.ctx)).toEqual({ devices: API, source: 'api' });
    expect(t.sdk.devices.list.mock.calls[0][1]).toMatchObject({ timeoutMs: 5000, maxRetries: 0 });
  });
  it('an API error: bundled with one warning; never NOT_LOGGED_IN', async () => {
    const t = testCtx(['capture', 'ios'], { home, env: KEY });
    t.sdk.devices.list.mockRejectedValue(
      new StoreshotError({ code: 'CONNECTION_ERROR', message: 'down' }),
    );
    expect((await loadCatalogue(t.ctx)).source).toBe('bundled');
    expect(t.stderr()).toContain(
      'Device list unavailable (CONNECTION_ERROR): using the list bundled with this CLI.',
    );
  });
  it('no key, or --offline: bundled, no call, no warning', async () => {
    const t = testCtx(['capture', 'ios'], { home });
    expect(await loadCatalogue(t.ctx)).toEqual({ devices: BUNDLED_DEVICES, source: 'bundled' });
    const o = testCtx(['capture', 'ios', '--offline'], { home, env: KEY });
    expect((await loadCatalogue(o.ctx)).source).toBe('bundled');
    expect(o.sdk.devices.list).not.toHaveBeenCalled();
    expect(t.stderr() + o.stderr()).toBe('');
  });
});
