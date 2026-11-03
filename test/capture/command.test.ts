import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakePlaywright } from './helpers/fakePlaywright.js';
import { cleanupCapture, doc, newHome, normalised, runCapture } from './helpers/runCapture.js';
import { makePng } from './shims/png.mjs';

afterEach(cleanupCapture);

describe('storeshot capture (spec §3, §11, §12)', () => {
  it('ios: captions.json, status bar restored, nothing temporary left; snapshot', async () => {
    const r = await runCapture([
      'capture',
      'ios',
      '--name',
      '01-map',
      '--caption',
      'Find every trail',
      '--clean-status-bar',
      '--settle',
      '0',
      '--app-name',
      'Trailmate',
      '--offline',
      '--json',
    ]);
    expect(r.code, r.stderr).toBe(0);
    const d = doc(r.stdout).data;
    expect(d.screens[0]).toMatchObject({
      file: '01-map.png',
      width: 1206,
      height: 2622,
      matchedDevice: null,
      presetMatch: null,
      placeholderCaption: false,
    });
    expect(d.statusBar).toEqual({
      requested: true,
      method: 'simctl_status_bar',
      applied: true,
      restored: true,
    });
    expect(d.next).toBe('storeshot set screens --store app_store');
    const folder = path.join(r.home, 'screens');
    expect(readdirSync(folder).sort()).toEqual(['01-map.png', 'captions.json']);
    expect(JSON.parse(readFileSync(path.join(folder, 'captions.json'), 'utf8'))).toEqual({
      app: { name: 'Trailmate' },
      screens: [{ file: '01-map.png', caption: 'Find every trail' }],
    });
    await expect(normalised(r)).toMatchFileSnapshot('../__snapshots__/json/capture-ios.json');
  });
  it('android: preset match, deprecated warning; snapshot', async () => {
    const r = await runCapture(
      [
        'capture',
        'android',
        '--device',
        'google_play_1080x2400',
        '--clean-status-bar',
        '--settle',
        '0',
        '--json',
      ],
      { png: makePng(1080, 2400), env: { STORESHOT_API_KEY: 'ss_test_' + 'a'.repeat(32) } },
    );
    expect(r.code, r.stderr).toBe(0);
    const d = doc(r.stdout);
    expect(d.warnings).toContain('google_play_1080x2400 is deprecated: use google_play_1080x2160.');
    expect(d.data.preset).toMatchObject({
      device: 'google_play_1080x2400',
      source: 'api',
      viewport: null,
    });
    expect(d.data.screens[0]).toMatchObject({
      file: '01.png',
      presetMatch: true,
      matchedDevice: 'google_play_1080x2400',
      placeholderCaption: true,
      caption: 'Screen 1',
    });
    expect(r.sdk.devices.list).toHaveBeenCalledTimes(1);
    await expect(normalised(r)).toMatchFileSnapshot('../__snapshots__/json/capture-android.json');
  });
  it('web: two routes, preset viewport; snapshot', async () => {
    fakePlaywright(newHome());
    const r = await runCapture(
      ['capture', 'web', 'http://127.0.0.1:9/', '--route', '/,/settings', '--offline', '--json'],
      {
        keepHome: true,
      },
    );
    expect(r.code, r.stderr).toBe(0);
    const d = doc(r.stdout).data;
    expect(d.screens.map((s: { file: string; url: string }) => [s.file, s.url])).toEqual([
      ['01-home.png', 'http://127.0.0.1:9/'],
      ['02-settings.png', 'http://127.0.0.1:9/settings'],
    ]);
    expect(d.preset).toMatchObject({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 });
    await expect(normalised(r)).toMatchFileSnapshot('../__snapshots__/json/capture-web.json');
  });
  it('reset: only the restore command; snapshot', async () => {
    const r = await runCapture(['capture', 'ios', '--reset-status-bar', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.shims.calls().map((c) => c.argv.at(-1))).toEqual(['-j', 'clear']);
    expect(existsSync(path.join(r.home, 'screens'))).toBe(false);
    await expect(normalised(r)).toMatchFileSnapshot('../__snapshots__/json/capture-reset.json');
  });
  it('a second capture appends to captions.json with the next number', async () => {
    await runCapture(['capture', 'ios', '--offline']);
    const r = await runCapture(['capture', 'ios', '--offline'], { keepHome: true });
    expect(r.code, r.stderr).toBe(0);
    const captions = JSON.parse(
      readFileSync(path.join(r.home, 'screens', 'captions.json'), 'utf8'),
    );
    expect(captions.screens.map((s: { file: string }) => s.file)).toEqual(['01.png', '02.png']);
    expect(r.stderr).toContain(
      'captions.json: placeholder caption for 02.png; edit it before storeshot set.',
    );
    expect(r.stdout).toContain(
      'Next: storeshot set screens --store app_store --app-name "<app name>"',
    );
  });
});
