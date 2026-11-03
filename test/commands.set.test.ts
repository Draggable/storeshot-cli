import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { set as runSet } from '../src/commands/set.js';
import { DEVICES, quote, set } from './helpers/fixtures.js';
import { testCtx } from './helpers/ctx.js';
import { writeShots } from './helpers/images.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('set');
afterAll(() => rmSync(home, { recursive: true, force: true }));
const CAPTIONS = {
  app: { name: 'Trailmate' },
  screens: [
    { file: '01-map.png', caption: 'Find every trail' },
    { file: '02-off.png', caption: 'Works offline' },
  ],
};
writeShots(path.join(home, 'shots'), ['01-map.png', '02-off.png', 'extra.png'], CAPTIONS);
const TEST = { STORESHOT_API_KEY: 'ss_test_' + 's'.repeat(32) };
const LIVE = { STORESHOT_API_KEY: 'ss_live_' + 's'.repeat(32) };
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e as { code: string }).code,
  );
const ready = (t: ReturnType<typeof testCtx>) => {
  t.sdk.devices.list.mockResolvedValue(DEVICES);
  let n = 0;
  t.sdk.uploads.create.mockImplementation(async () => ({ id: `up_${++n}` }));
  t.sdk.screenshotSets.quote.mockResolvedValue(quote());
  t.sdk.screenshotSets.create.mockResolvedValue(set('queued'));
  t.sdk.screenshotSets.get.mockResolvedValue(set('succeeded'));
};

describe('set (spec §8.2)', () => {
  it('builds the exact body from captions.json, --store and --devices; test keys skip the quote', async () => {
    const t = testCtx(
      [
        'set',
        'shots',
        '--store',
        'app_store,google_play',
        '--devices',
        'google_play_1080x2160',
        '--feature-graphic',
        '--timeout',
        '5',
      ],
      { home, env: TEST },
    );
    ready(t);
    const r = await runSet(t.ctx);
    expect(t.sdk.screenshotSets.create).toHaveBeenCalledWith(
      {
        app: { name: 'Trailmate' },
        screens: [
          { input: { uploadId: 'up_1' }, caption: 'Find every trail' },
          { input: { uploadId: 'up_2' }, caption: 'Works offline' },
        ],
        stores: [
          { store: 'app_store' },
          { store: 'google_play', devices: ['google_play_1080x2160'], featureGraphic: true },
        ],
      },
      expect.anything(),
    );
    expect(t.sdk.screenshotSets.quote).not.toHaveBeenCalled();
    expect(r.data).toMatchObject({
      mode: 'set',
      quote: null,
      set: { status: 'succeeded' },
      download: null,
    });
    expect(t.stderr()).toContain('extra.png');
  });
  it('--dry-run quotes and creates nothing', async () => {
    const t = testCtx(['set', 'shots', '--store', 'app_store', '--dry-run'], { home, env: TEST });
    ready(t);
    const r = await runSet(t.ctx);
    expect(r.data).toMatchObject({ mode: 'quote', quote: { images: 5 }, set: null });
    expect(t.sdk.screenshotSets.create).not.toHaveBeenCalled();
  });
  it('live: the quote drives the guard (insufficient → 4, no --yes → 11)', async () => {
    const a = testCtx(['set', 'shots', '--store', 'app_store'], { home, env: LIVE });
    ready(a);
    a.sdk.screenshotSets.quote.mockResolvedValue(
      quote({ environment: 'live', credits: 4, availableCredits: 1, sufficient: false }),
    );
    expect(await code(runSet(a.ctx))).toBe('INSUFFICIENT_CREDITS');
    const b = testCtx(['set', 'shots', '--store', 'app_store'], { home, env: LIVE });
    ready(b);
    b.sdk.screenshotSets.quote.mockResolvedValue(
      quote({ environment: 'live', credits: 4, availableCredits: 10, sufficient: true }),
    );
    await expect(runSet(b.ctx)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      opts: { data: { mode: 'quote', quote: { credits: 4 } } },
    });
    expect(b.sdk.screenshotSets.create).not.toHaveBeenCalled();
  });
  it('a missing captions file, a missing listed file and --layout without --out are errors', async () => {
    writeShots(path.join(home, 'nocap'), ['a.png']);
    expect(
      await code(
        runSet(testCtx(['set', 'nocap', '--store', 'app_store'], { home, env: TEST }).ctx),
      ),
    ).toBe('USAGE');
    writeShots(path.join(home, 'missing'), [], { screens: [{ file: 'gone.png', caption: 'x' }] });
    const t = testCtx(['set', 'missing', '--store', 'app_store', '--app-name', 'X'], {
      home,
      env: TEST,
    });
    expect(await code(runSet(t.ctx))).toBe('NOT_A_FILE');
    expect(
      await code(
        runSet(
          testCtx(['set', 'shots', '--store', 'app_store', '--layout', 'fastlane'], {
            home,
            env: TEST,
          }).ctx,
        ),
      ),
    ).toBe('USAGE');
  });
  it('partially_failed → PARTIAL_FAILURE (exit 9) with the set data', async () => {
    const t = testCtx(['set', 'shots', '--store', 'app_store'], { home, env: TEST });
    ready(t);
    t.sdk.screenshotSets.get.mockResolvedValue(set('partially_failed'));
    await expect(runSet(t.ctx)).rejects.toMatchObject({
      code: 'PARTIAL_FAILURE',
      opts: { data: { set: { status: 'partially_failed' } } },
    });
  });
});
