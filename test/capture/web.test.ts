import { rmSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { BUNDLED_DEVICES, presetFor } from '../../src/capture/catalogue.js';
import {
  atLeast,
  resolvePlaywright,
  setPlaywrightDepsForTests,
} from '../../src/capture/playwright.js';
import { runWeb, type WebOptions } from '../../src/capture/runWeb.js';
import { testCtx } from '../helpers/ctx.js';
import { tmpDir } from '../helpers/tmp.js';
import { fakePlaywright } from './helpers/fakePlaywright.js';

const home = tmpDir('web');
afterAll(() => rmSync(home, { recursive: true, force: true }));
afterEach(() => setPlaywrightDepsForTests(null));
const preset = presetFor(BUNDLED_DEVICES[1], 'portrait', 'bundled', true, () => {});
const options = (over: Partial<WebOptions> = {}): WebOptions => ({
  preset,
  shots: [
    {
      file: '01-home.png',
      url: 'http://127.0.0.1:9/',
      waitFor: '[data-testid="ready"]',
      delayMs: 0,
    },
    { file: '02-settings.png', url: 'http://127.0.0.1:9/settings', delayMs: 250 },
  ],
  waitUntil: 'load',
  colorScheme: 'light',
  locale: 'en-US',
  timeoutMs: 5000,
  ...over,
});
const ctxWith = (env: Record<string, string> = {}) =>
  testCtx(['capture', 'web', 'http://127.0.0.1:9/'], { home, env });

describe('Playwright resolution (spec §9.1)', () => {
  it('atLeast', () => {
    expect(atLeast('1.64.1', '1.40.0')).toBe(true);
    expect(atLeast('1.40.0', '1.40.0')).toBe(true);
    expect(atLeast('1.39.9', '1.40.0')).toBe(false);
    expect(atLeast('2.0.0-beta.1', '1.40.0')).toBe(true);
  });
  it('too old or missing: CAPTURE_TOOL_MISSING with the install hint', async () => {
    fakePlaywright(tmpDir('old'), { version: '1.30.0' });
    await expect(resolvePlaywright(home)).rejects.toMatchObject({
      code: 'CAPTURE_TOOL_MISSING',
      message: expect.stringMatching(/1\.30\.0 is too old/),
    });
    setPlaywrightDepsForTests({ resolve: () => null, load: async () => ({}) });
    await expect(resolvePlaywright(home)).rejects.toMatchObject({
      code: 'CAPTURE_TOOL_MISSING',
      opts: { hint: expect.stringContaining('npm install -D playwright') },
    });
  });
});

describe('runWeb (spec §9.3)', () => {
  it('launch and context options, the per-page steps, browser closed', async () => {
    const pw = fakePlaywright(tmpDir('pw'));
    const t = ctxWith({ PATH: '/bin', STORESHOT_API_KEY: 'ss_test_' + 'w'.repeat(32) });
    const r = await runWeb(t.ctx, options());
    expect(r.images).toHaveLength(2);
    expect(r.tool).toEqual({ name: 'playwright', path: pw.pkg, version: '1.64.1' });
    const launch = pw.calls[0].arg as Record<string, unknown>;
    expect(launch).toMatchObject({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    const env = launch.env as Record<string, string>;
    expect(env.PATH).toBe('/bin');
    expect(Object.keys(env).filter((k) => /^storeshot_/i.test(k))).toEqual([]);
    expect(pw.calls[1].arg).toEqual({
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'light',
      locale: 'en-US',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    expect(pw.calls.slice(2).map((c) => c.what)).toEqual([
      'goto',
      'waitForSelector',
      'evaluate',
      'screenshot',
      'page.close',
      'goto',
      'evaluate',
      'waitForTimeout',
      'screenshot',
      'page.close',
      'browser.close',
    ]);
    expect(pw.calls.find((c) => c.what === 'screenshot')!.arg).toEqual({
      type: 'png',
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
      timeout: 5000,
    });
  });
  it('HTTP ≥ 400 and a selector timeout are CAPTURE_FAILED naming the URL; browser closed', async () => {
    const a = fakePlaywright(tmpDir('pw404'), { status: 404 });
    await expect(runWeb(ctxWith().ctx, options())).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
      message: 'http://127.0.0.1:9/ answered HTTP 404.',
      opts: { details: { url: 'http://127.0.0.1:9/', status: 404 } },
    });
    expect(a.calls.at(-1)!.what).toBe('browser.close');
    fakePlaywright(tmpDir('pwsel'), { selectorFails: true });
    await expect(runWeb(ctxWith().ctx, options())).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
      message:
        'Waiting for [data-testid="ready"] failed: page.waitForSelector: Timeout 5000ms exceeded.',
    });
  });
  it('Chromium not installed: CAPTURE_TOOL_MISSING', async () => {
    fakePlaywright(tmpDir('pwexe'), {
      launchError:
        "browserType.launch: Executable doesn't exist at /x/chrome\nLooks like Playwright was just installed: npx playwright install",
    });
    await expect(runWeb(ctxWith().ctx, options())).rejects.toMatchObject({
      code: 'CAPTURE_TOOL_MISSING',
    });
  });
});
