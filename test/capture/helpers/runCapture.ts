import { rmSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { expect } from 'vitest';
import { BUNDLED_DEVICES } from '../../../src/capture/catalogue.js';
import { setPlaywrightDepsForTests } from '../../../src/capture/playwright.js';
import { SCHEMAS } from '../../../src/jsonSchemas.js';
import { main } from '../../../src/main.js';
import { fakeSdk } from '../../helpers/fakeSdk.js';
import { captured } from '../../helpers/streams.js';
import { tmpDir } from '../../helpers/tmp.js';
import { installShims, type Shims } from '../shims/install.mjs';
import { makePng } from '../shims/png.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
let shims: Shims | null = null;
let home = '';

/** A fresh home for the next runCapture (e.g. to install a fake Playwright in it first). */
export function newHome(): string {
  home = tmpDir('capture');
  return home;
}

/** main() with the fake tools first on PATH, a fake SDK and a fixed clock. */
export async function runCapture(
  argv: string[],
  opts: {
    scenario?: string[];
    png?: Buffer;
    env?: Record<string, string>;
    keepHome?: boolean;
  } = {},
) {
  shims?.cleanup();
  if (!opts.keepHome || !home) newHome();
  shims = installShims({ png: opts.png ?? makePng(1206, 2622), scenario: opts.scenario });
  const c = captured();
  const sdk = fakeSdk();
  sdk.devices.list.mockResolvedValue({ data: BUNDLED_DEVICES });
  const code = await main(argv, {
    streams: c.streams,
    env: { ...shims.env, XDG_CONFIG_HOME: path.join(home, 'config'), ...opts.env },
    signal: new AbortController().signal,
    signalName: () => null,
    stdinIsTTY: false,
    cwd: home,
    homedir: home,
    prompt: async () => null,
    createClient: () => sdk as never,
    now: () => Date.parse('2026-11-03T10:00:00.000Z'),
    pollMs: 1,
  });
  return { code, stdout: c.stdout(), stderr: c.stderr(), sdk, shims, home };
}

/** afterEach: fake tools, the home folder and the Playwright hook. */
export function cleanupCapture(): void {
  shims?.cleanup();
  shims = null;
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
  setPlaywrightDepsForTests(null);
}

/** The one JSON document, validated against schemas/capture.schema.json. */
export function doc(stdout: string) {
  const lines = stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  const d = JSON.parse(lines[0]);
  const validate = ajv.compile(SCHEMAS.capture);
  expect(validate(d), JSON.stringify(validate.errors)).toBe(true);
  return d;
}

export const normalised = (r: { stdout: string; shims: Shims; home: string }) =>
  JSON.stringify(JSON.parse(r.stdout), null, 2)
    .split(r.shims.dir)
    .join('<shims>')
    .split(r.home)
    .join('<home>');
