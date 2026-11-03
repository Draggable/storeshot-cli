import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StoreshotError } from '@draggable/storeshot-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { generate } from '../src/commands/generate.js';
import { DEVICES, generation } from './helpers/fixtures.js';
import { testCtx } from './helpers/ctx.js';
import { writeShots } from './helpers/images.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('gen');
afterAll(() => rmSync(home, { recursive: true, force: true }));
writeShots(home, ['home.png', 'map.png']);
writeFileSync(path.join(home, 'notes.txt'), 'hello');
const TEST = { STORESHOT_API_KEY: 'ss_test_' + 'g'.repeat(32) };
const LIVE = { STORESHOT_API_KEY: 'ss_live_' + 'g'.repeat(32) };
const ARGS = ['--store', 'app_store', '--device', 'app_store_1290x2796', '--app-name', 'Trailmate'];
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e as { code: string }).code,
  );
const ready = (t: ReturnType<typeof testCtx>) => {
  t.sdk.devices.list.mockResolvedValue(DEVICES);
  t.sdk.uploads.create.mockResolvedValue({ id: 'up_1' });
  t.sdk.generations.create.mockResolvedValue(generation('queued'));
  t.sdk.waitForGeneration.mockResolvedValue(generation('succeeded'));
};

describe('generate (spec §8.1)', () => {
  it('sends the exact body per file and waits', async () => {
    const t = testCtx(
      [
        'generate',
        'home.png',
        ...ARGS,
        '--caption',
        'Find every trail',
        '--palette',
        '#1E88E5:Sky',
      ],
      { home, env: TEST },
    );
    ready(t);
    const r = await generate(t.ctx);
    expect(t.sdk.generations.create).toHaveBeenCalledWith(
      {
        inputs: [{ uploadId: 'up_1' }],
        store: 'app_store',
        device: 'app_store_1290x2796',
        app: { name: 'Trailmate' },
        caption: 'Find every trail',
        palette: [{ hex: '#1E88E5', name: 'Sky' }],
      },
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^storeshot-cli-/) }),
    );
    expect(r.data).toMatchObject({
      environment: 'test',
      creditsCharged: 0,
      generations: [{ input: 'home.png', status: 'succeeded' }],
      download: null,
    });
    expect(r.human.join('\n')).toContain('Test key: sample images, no credits spent.');
  });
  it('checks every file before uploading anything', async () => {
    const t = testCtx(['generate', 'home.png', 'notes.txt', ...ARGS], { home, env: TEST });
    ready(t);
    expect(await code(generate(t.ctx))).toBe('UNSUPPORTED_FILE_TYPE');
    expect(t.sdk.uploads.create).not.toHaveBeenCalled();
  });
  it('--idempotency-key gets -NN per file', async () => {
    const t = testCtx(['generate', 'home.png', 'map.png', ...ARGS, '--idempotency-key', 'run-7'], {
      home,
      env: TEST,
    });
    ready(t);
    await generate(t.ctx);
    expect(t.sdk.generations.create.mock.calls.map((c) => c[1].idempotencyKey)).toEqual([
      'run-7-01',
      'run-7-02',
    ]);
  });
  it('an unknown or wrong-store device is USAGE before uploads', async () => {
    const t = testCtx(
      [
        'generate',
        'home.png',
        '--store',
        'app_store',
        '--device',
        'google_play_1080x2160',
        '--app-name',
        'X',
      ],
      { home, env: TEST },
    );
    ready(t);
    expect(await code(generate(t.ctx))).toBe('USAGE');
    expect(t.sdk.uploads.create).not.toHaveBeenCalled();
  });
  it('a failed image → PARTIAL_FAILURE with the data', async () => {
    const t = testCtx(['generate', 'home.png', ...ARGS], { home, env: TEST });
    ready(t);
    t.sdk.waitForGeneration.mockResolvedValue(generation('failed'));
    await expect(generate(t.ctx)).rejects.toMatchObject({
      code: 'PARTIAL_FAILURE',
      opts: { data: { generations: [{ status: 'failed' }] } },
    });
  });
  it('live: not a TTY and no --yes → CONFIRMATION_REQUIRED, nothing uploaded or created', async () => {
    const t = testCtx(['generate', 'home.png', ...ARGS], { home, env: LIVE });
    ready(t);
    t.sdk.credits.get.mockResolvedValue({
      total: 10,
      balances: { starter: 10, subscription: 0, purchased: 0 },
    });
    expect(await code(generate(t.ctx))).toBe('CONFIRMATION_REQUIRED');
    expect(t.sdk.uploads.create).not.toHaveBeenCalled();
    expect(t.sdk.generations.create).not.toHaveBeenCalled();
  });
  it('CONCURRENCY_LIMITED waits for the earlier image, then retries with the same key', async () => {
    const t = testCtx(['generate', 'home.png', 'map.png', ...ARGS], { home, env: TEST });
    ready(t);
    t.sdk.generations.create
      .mockResolvedValueOnce(generation('running'))
      .mockRejectedValueOnce(
        new StoreshotError({ code: 'CONCURRENCY_LIMITED', message: 'busy', status: 429 }),
      )
      .mockResolvedValueOnce(generation('queued'));
    await generate(t.ctx);
    const keys = t.sdk.generations.create.mock.calls.map((c) => c[1].idempotencyKey);
    expect(keys[1]).toBe(keys[2]);
    expect(t.sdk.waitForGeneration).toHaveBeenCalled();
  });
  it('--out with --no-wait is USAGE; exactly one of --device/--size', async () => {
    expect(
      await code(
        generate(
          testCtx(['generate', 'home.png', ...ARGS, '--no-wait', '--out', 'x'], { home, env: TEST })
            .ctx,
        ),
      ),
    ).toBe('USAGE');
    expect(
      await code(
        generate(
          testCtx(['generate', 'home.png', '--store', 'app_store', '--app-name', 'X'], {
            home,
            env: TEST,
          }).ctx,
        ),
      ),
    ).toBe('USAGE');
  });
});
