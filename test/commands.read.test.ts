import { rmSync } from 'node:fs';
import { StoreshotError } from '@draggable/storeshot-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { credits } from '../src/commands/credits.js';
import { devices } from '../src/commands/devices.js';
import { DEVICES } from './helpers/fixtures.js';
import { testCtx } from './helpers/ctx.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('read');
afterAll(() => rmSync(home, { recursive: true, force: true }));
const env = { STORESHOT_API_KEY: 'ss_test_' + 'r'.repeat(32) };

describe('credits', () => {
  it('returns the balances', async () => {
    const t = testCtx(['credits'], { home, env });
    t.sdk.credits.get.mockResolvedValue({
      balances: { starter: 1, subscription: 0, purchased: 3 },
      total: 4,
    });
    const r = await credits(t.ctx);
    expect(r.data).toEqual({
      environment: 'test',
      total: 4,
      balances: { starter: 1, subscription: 0, purchased: 3 },
    });
    expect(r.human[0]).toContain('4 credits');
  });
  it('a 403 says which scope is missing', async () => {
    const t = testCtx(['credits'], { home, env });
    t.sdk.credits.get.mockRejectedValue(
      new StoreshotError({ code: 'FORBIDDEN', message: 'no', status: 403 }),
    );
    await expect(credits(t.ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      opts: { hint: expect.stringContaining('usage:read') },
    });
  });
});

describe('devices', () => {
  it('hides deprecated sizes unless --include-deprecated; passes --store', async () => {
    const t = testCtx(['devices', '--store', 'google_play'], { home, env });
    t.sdk.devices.list.mockResolvedValue(DEVICES);
    const r = (await devices(t.ctx)) as { data: { devices: { id: string }[] }; human: string[] };
    expect(t.sdk.devices.list).toHaveBeenCalledWith({ store: 'google_play' }, expect.anything());
    expect(r.data.devices.map((d) => d.id)).not.toContain('google_play_1080x2400');
    const all = testCtx(['devices', '--include-deprecated'], { home, env });
    all.sdk.devices.list.mockResolvedValue(DEVICES);
    expect(((await devices(all.ctx)).data as { devices: unknown[] }).devices).toHaveLength(5);
  });
  it('rejects an unknown store', async () => {
    const t = testCtx(['devices', '--store', 'steam'], { home, env });
    await expect(devices(t.ctx)).rejects.toMatchObject({ code: 'USAGE' });
  });
});
