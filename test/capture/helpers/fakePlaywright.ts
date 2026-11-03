// A structural fake of the Playwright surface runWeb uses (spec §16.1), installed through
// setPlaywrightDepsForTests. A real package.json is written so the version check reads a file.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setPlaywrightDepsForTests } from '../../../src/capture/playwright.js';
import { makePng } from '../shims/png.mjs';

export interface FakeCall {
  what: string;
  arg?: unknown;
}
export function fakePlaywright(
  dir: string,
  opts: {
    version?: string;
    status?: number;
    selectorFails?: boolean;
    launchError?: string;
    png?: Buffer;
    onGoto?: () => void;
  } = {},
) {
  const calls: FakeCall[] = [];
  const pkg = path.join(dir, 'node_modules', 'playwright');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'playwright', version: opts.version ?? '1.64.1' }),
  );
  writeFileSync(path.join(pkg, 'index.js'), '');
  const png = opts.png ?? makePng(1290, 2796);
  const page = {
    goto: async (url: string, o: object) => {
      calls.push({ what: 'goto', arg: { url, ...o } });
      opts.onGoto?.();
      return { status: () => opts.status ?? 200 };
    },
    waitForSelector: async (s: string, o: { timeout: number }) => {
      calls.push({ what: 'waitForSelector', arg: s });
      if (opts.selectorFails)
        throw new Error(`page.waitForSelector: Timeout ${o.timeout}ms exceeded.\nCall log: …`);
    },
    evaluate: async () => {
      calls.push({ what: 'evaluate' });
      return null;
    },
    waitForTimeout: async (ms: number) => {
      calls.push({ what: 'waitForTimeout', arg: ms });
    },
    screenshot: async (o: object) => {
      calls.push({ what: 'screenshot', arg: o });
      return png;
    },
    close: async () => {
      calls.push({ what: 'page.close' });
    },
  };
  const browser = {
    newContext: async (o: object) => {
      calls.push({ what: 'newContext', arg: o });
      return { newPage: async () => page, close: async () => {} };
    },
    close: async () => {
      calls.push({ what: 'browser.close' });
    },
  };
  const chromium = {
    launch: async (o: object) => {
      calls.push({ what: 'launch', arg: o });
      if (opts.launchError) throw new Error(opts.launchError);
      return browser;
    },
  };
  setPlaywrightDepsForTests({
    resolve: (_cwd, name) => (name === 'playwright' ? path.join(pkg, 'index.js') : null),
    load: async () => ({ chromium }),
  });
  return { calls, pkg };
}
