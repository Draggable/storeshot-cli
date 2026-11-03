import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupCapture, runCapture } from './helpers/runCapture.js';
import { makePng } from './shims/png.mjs';

afterEach(cleanupCapture);

const KEY = 'ss_test_' + 'L'.repeat(32);
const errorOf = (stdout: string) => JSON.parse(stdout.trim()).error;

describe('capture failures are one valid document with the right exit (spec §13)', () => {
  it.each([
    [['none'], 5, 'CAPTURE_DEVICE_NOT_FOUND'],
    [['two-booted'], 2, 'CAPTURE_DEVICE_AMBIGUOUS'],
    [['simctl-missing'], 12, 'CAPTURE_TOOL_MISSING'],
    [['screenshot-fails'], 12, 'CAPTURE_FAILED'],
    [['not-png'], 12, 'CAPTURE_FAILED'],
  ])('ios scenario %j → %i %s', async (scenario, exit, code) => {
    const r = await runCapture(['capture', 'ios', '--offline', '--json'], { scenario });
    expect(r.code).toBe(exit);
    expect(errorOf(r.stdout).code).toBe(code);
    expect(readdirSync(path.join(r.home, 'screens'))).toEqual([]);
  });
  it('no tool on PATH → 12 CAPTURE_TOOL_MISSING', async () => {
    const r = await runCapture(['capture', 'android', '--offline', '--json'], {
      env: { PATH: '/nonexistent' },
    });
    expect([r.code, errorOf(r.stdout).code]).toEqual([12, 'CAPTURE_TOOL_MISSING']);
  });
  it('NOT_A_SCREENSHOT → 2, status bar restored first, nothing written', async () => {
    const r = await runCapture(
      ['capture', 'ios', '--clean-status-bar', '--settle', '0', '--offline', '--json'],
      {
        png: makePng(2000, 200),
      },
    );
    expect([r.code, errorOf(r.stdout).code]).toEqual([2, 'NOT_A_SCREENSHOT']);
    expect(r.shims.calls().at(-1)!.argv.at(-1)).toBe('clear');
    expect(readdirSync(path.join(r.home, 'screens'))).toEqual([]);
  });
  it('an existing PNG → 12 FILE_EXISTS before any tool runs; --force replaces it', async () => {
    const first = await runCapture(['capture', 'ios', '--name', 'a', '--offline']);
    expect(first.code).toBe(0);
    const again = await runCapture(['capture', 'ios', '--name', 'a', '--offline', '--json'], {
      keepHome: true,
    });
    expect([again.code, errorOf(again.stdout).code]).toEqual([12, 'FILE_EXISTS']);
    expect(again.shims.calls()).toEqual([]);
    const forced = await runCapture(['capture', 'ios', '--name', 'a', '--force', '--offline'], {
      keepHome: true,
    });
    expect(forced.code).toBe(0);
  });
  it('restore failure → 12 STATUS_BAR_NOT_RESTORED with the files written and data', async () => {
    const r = await runCapture(
      ['capture', 'ios', '--clean-status-bar', '--settle', '0', '--offline', '--json'],
      {
        scenario: ['restore-fails'],
      },
    );
    const d = JSON.parse(r.stdout.trim());
    expect([r.code, d.error.code]).toEqual([12, 'STATUS_BAR_NOT_RESTORED']);
    expect(d.error.hint).toMatch(
      /xcrun simctl status_bar AAAAAAAA-1111-4111-8111-111111111111 clear/,
    );
    expect(d.data.statusBar.restored).toBe(false);
    expect(readdirSync(path.join(r.home, 'screens')).sort()).toEqual(['01.png', 'captions.json']);
  });
  it('an invalid captions.json → 2 USAGE before any tool runs', async () => {
    const r0 = await runCapture(['capture', 'ios', '--offline']);
    writeFileSync(path.join(r0.home, 'screens', 'captions.json'), '{"screens":[]}');
    const r = await runCapture(['capture', 'ios', '--offline', '--json'], { keepHome: true });
    expect([r.code, errorOf(r.stdout).code]).toEqual([2, 'USAGE']);
    expect(r.shims.calls()).toEqual([]);
  });
  it('web: an 11th screen in captions.json → 2 before the browser starts', async () => {
    const r0 = await runCapture(['capture', 'ios', '--offline']);
    const folder = path.join(r0.home, 'screens');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, 'captions.json'),
      JSON.stringify({
        screens: Array.from({ length: 10 }, (_, i) => ({ file: `${i}.png`, caption: 'c' })),
      }),
    );
    const r = await runCapture(['capture', 'web', 'http://127.0.0.1:9/', '--offline', '--json'], {
      keepHome: true,
    });
    expect([r.code, errorOf(r.stdout).code]).toEqual([2, 'USAGE']);
  });
  it('never passes a key or a STORESHOT_* variable to a child process (spec §5.3)', async () => {
    const r = await runCapture(
      ['capture', 'android', '--clean-status-bar', '--settle', '0', '--api-key', KEY, '--json'],
      {
        png: makePng(1080, 2400),
        env: {
          STORESHOT_API_KEY: KEY,
          STORESHOT_BASE_URL: 'https://api.storeshot.art/v1',
          STORESHOT_ENVIRONMENT: 'test',
        },
      },
    );
    expect(r.code, r.stderr).toBe(0);
    const calls = r.shims.calls();
    expect(calls.length).toBeGreaterThan(10);
    for (const call of calls) {
      expect(Object.keys(call.env).filter((k) => /^storeshot_/i.test(k))).toEqual([]);
      expect(JSON.stringify(call)).not.toContain(KEY);
    }
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });
});
