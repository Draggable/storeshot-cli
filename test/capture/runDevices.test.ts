import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAndroid } from '../../src/capture/runAndroid.js';
import { runIos } from '../../src/capture/runIos.js';
import { testCtx } from '../helpers/ctx.js';
import { tmpDir } from '../helpers/tmp.js';
import { installShims, type Shims } from './shims/install.mjs';
import { makePng } from './shims/png.mjs';

let shims: Shims | null = null;
let home = '';
afterEach(() => {
  shims?.cleanup();
  if (home) rmSync(home, { recursive: true, force: true });
});
function setup(form: 'ios' | 'android', scenario: string[] = [], png = makePng(1206, 2622)) {
  home = tmpDir('rundev');
  shims = installShims({ png, scenario });
  const folder = path.join(home, 'screens');
  mkdirSync(folder);
  const t = testCtx(['capture', form], { home, env: shims.env });
  return { t, folder, opts: { folder, cleanStatusBar: true, settleMs: 0, timeoutMs: 5000 } };
}
const steps = (s: Shims) => s.calls().map((c) => c.argv.filter((a) => !a.includes('/')).join(' '));

describe('runIos (spec §7)', () => {
  it('lists, overrides, captures into a temp folder it removes, clears', async () => {
    const { t, folder, opts } = setup('ios');
    const r = await runIos(t.ctx, opts);
    expect(r.target).toEqual({
      kind: 'simulator',
      id: 'AAAAAAAA-1111-4111-8111-111111111111',
      name: 'iPhone 16 Pro',
      os: 'iOS 18.2',
    });
    expect(r.images).toHaveLength(1);
    expect(r.statusBar).toEqual({
      requested: true,
      method: 'simctl_status_bar',
      applied: true,
      restored: true,
    });
    expect(steps(shims!).map((s) => s.split(' ').slice(0, 2).join(' '))).toEqual([
      'simctl list',
      'simctl status_bar',
      'simctl io',
      'simctl status_bar',
    ]);
    expect(shims!.calls()[2].argv.at(-1)).toMatch(
      /\/screens\/\.storeshot-capture-[^/]+\/shot\.png$/,
    );
    expect(readdirSync(folder)).toEqual([]);
    expect(t.ctx.interrupt).toEqual({ note: 'Nothing was written. Status bar restored.' });
  });
  it('a failed screenshot still clears the status bar', async () => {
    const { t, opts } = setup('ios', ['screenshot-fails']);
    await expect(runIos(t.ctx, opts)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    expect(shims!.calls().at(-1)!.argv.slice(-1)).toEqual(['clear']);
  });
  it('xcrun without simctl is CAPTURE_TOOL_MISSING', async () => {
    const { t, opts } = setup('ios', ['simctl-missing']);
    await expect(runIos(t.ctx, opts)).rejects.toMatchObject({ code: 'CAPTURE_TOOL_MISSING' });
  });
  it('a non-image file is CAPTURE_FAILED', async () => {
    const { t, opts } = setup('ios', ['not-png']);
    await expect(runIos(t.ctx, { ...opts, cleanStatusBar: false })).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
    });
  });
});

describe('runAndroid (spec §8)', () => {
  it('devices, props, demo mode on, screencap, demo mode off, setting restored', async () => {
    const { t, opts } = setup('android', [], makePng(1080, 2400));
    const r = await runAndroid(t.ctx, opts);
    expect(r.tool).toMatchObject({ name: 'adb', version: 'Android Debug Bridge version 1.0.41' });
    expect(r.target).toEqual({
      kind: 'android_device',
      id: 'emulator-5554',
      name: 'Pixel 8',
      os: 'Android 15',
    });
    const words = shims!.calls().map((c) => c.argv.join(' '));
    expect(words.at(-3)).toBe('-s emulator-5554 exec-out screencap -p');
    expect(words.at(-2)).toMatch(/-e command exit$/);
    expect(words.at(-1)).toBe('-s emulator-5554 shell settings delete global sysui_demo_allowed');
    expect(r.statusBar.restored).toBe(true);
  });
  it('ANDROID_SERIAL picks the device; a bad one is ignored with a warning', async () => {
    const { opts } = setup('android', ['two-devices'], makePng(1080, 2400));
    const t = testCtx(['capture', 'android'], {
      home,
      env: { ...shims!.env, ANDROID_SERIAL: 'emulator-5556' },
    });
    expect((await runAndroid(t.ctx, { ...opts, cleanStatusBar: false })).target.id).toBe(
      'emulator-5556',
    );
    const bad = testCtx(['capture', 'android'], {
      home,
      env: { ...shims!.env, ANDROID_SERIAL: '-x' },
    });
    await expect(runAndroid(bad.ctx, opts)).rejects.toMatchObject({
      code: 'CAPTURE_DEVICE_AMBIGUOUS',
    });
    expect(bad.stderr()).toContain('Ignoring ANDROID_SERIAL');
  });
  it('unauthorized device: CAPTURE_DEVICE_NOT_FOUND with the USB debugging hint', async () => {
    const { t, opts } = setup('android', ['adb-unauthorized']);
    await expect(runAndroid(t.ctx, opts)).rejects.toMatchObject({
      code: 'CAPTURE_DEVICE_NOT_FOUND',
      opts: { hint: expect.stringContaining('Allow USB debugging') },
    });
  });
  it('a stdout above 64 MiB is refused', async () => {
    const { t, opts } = setup('android', ['huge-stdout']);
    await expect(runAndroid(t.ctx, { ...opts, cleanStatusBar: false })).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
      message: expect.stringMatching(/more than 67108864 bytes/),
    });
  });
});
