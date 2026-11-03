import { rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { makeZip } from '@storeshot/mcp-test/helpers/zip.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterAll, describe, expect, it } from 'vitest';
import { SCHEMAS } from '../src/jsonSchemas.js';
import { main } from '../src/main.js';
import { fakeSdk, type FakeSdk } from './helpers/fakeSdk.js';
import { DEVICES, SET_ID, generation, quote, set } from './helpers/fixtures.js';
import { writeShots } from './helpers/images.js';
import { captured } from './helpers/streams.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('main');
afterAll(() => rmSync(home, { recursive: true, force: true }));
writeShots(path.join(home, 'shots'), ['01.png'], {
  app: { name: 'Trailmate' },
  screens: [{ file: '01.png', caption: 'Find' }],
});
const KEY = 'ss_test_' + 'm'.repeat(32);
const ajv = new Ajv2020({ strict: true, allErrors: true });

async function run(
  argv: string[],
  setup: (sdk: FakeSdk) => void = () => {},
  env: Record<string, string> = { STORESHOT_API_KEY: KEY },
) {
  const c = captured();
  const sdk = fakeSdk();
  setup(sdk);
  const code = await main(argv, {
    streams: c.streams,
    env: { XDG_CONFIG_HOME: path.join(home, 'config'), ...env },
    signal: new AbortController().signal,
    signalName: () => null,
    stdinIsTTY: false,
    cwd: home,
    homedir: home,
    prompt: async () => null,
    createClient: () => sdk as never,
    // A fixed clock keeps the snapshots (expiresAt, waited.seconds) deterministic.
    now: () => Date.parse('2026-11-03T10:00:00.000Z'),
    pollMs: 1,
  });
  return { code, stdout: c.stdout(), stderr: c.stderr(), sdk };
}
const normalise = (text: string) => text.split(home).join('<home>');
const checked = (command: string, stdout: string) => {
  const lines = stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  const doc = JSON.parse(lines[0]);
  const validate = ajv.compile(SCHEMAS[command] ?? SCHEMAS.envelope);
  expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  return doc;
};

const CASES: [string, string[], (sdk: FakeSdk) => void][] = [
  [
    'whoami',
    ['whoami', '--json'],
    (s) =>
      s.me.mockResolvedValue({
        user: { id: 'u1', displayName: 'Dev', avatarUrl: null, createdAt: 'x' },
        credential: {
          type: 'api_key',
          environment: 'test',
          scopes: ['usage:read'],
          apiKey: { id: 'k1', name: 'ci', prefix: 'ss_test_ab', expiresAt: null },
        },
      }),
  ],
  [
    'credits',
    ['credits', '--json'],
    (s) =>
      s.credits.get.mockResolvedValue({
        balances: { starter: 4, subscription: 0, purchased: 0 },
        total: 4,
      }),
  ],
  ['devices', ['devices', '--json'], (s) => s.devices.list.mockResolvedValue(DEVICES)],
  [
    'generate',
    [
      'generate',
      'shots/01.png',
      '--store',
      'app_store',
      '--device',
      'app_store_1290x2796',
      '--app-name',
      'Trailmate',
      '--json',
    ],
    (s) => {
      s.devices.list.mockResolvedValue(DEVICES);
      s.uploads.create.mockResolvedValue({ id: 'up_1' });
      s.generations.create.mockResolvedValue(generation('queued'));
      s.waitForGeneration.mockResolvedValue(generation('succeeded'));
    },
  ],
  [
    'set',
    ['set', 'shots', '--store', 'app_store', '--dry-run', '--json'],
    (s) => {
      s.devices.list.mockResolvedValue(DEVICES);
      s.uploads.create.mockResolvedValue({ id: 'up_1' });
      s.screenshotSets.quote.mockResolvedValue(quote());
    },
  ],
  [
    'status',
    ['status', SET_ID, '--json'],
    (s) => s.screenshotSets.get.mockResolvedValue(set('succeeded')),
  ],
  [
    'pull',
    ['pull', SET_ID, '--out', 'pulled', '--json'],
    (s) => {
      s.screenshotSets.get.mockResolvedValue(set('succeeded'));
      s.screenshotSets.archiveStream.mockResolvedValue(
        Readable.toWeb(
          Readable.from([makeZip([{ name: 'app_store/app_store_1290x2796/01.png', data: 'P' }])]),
        ),
      );
    },
  ],
];

describe('--json output of every command (spec §11)', () => {
  it.each(CASES)('%s', async (command, argv, setup) => {
    const r = await run(argv, setup);
    expect(r.code, r.stderr).toBe(0);
    const doc = checked(command, r.stdout);
    await expect(normalise(JSON.stringify(doc, null, 2))).toMatchFileSnapshot(
      `__snapshots__/json/${command}.json`,
    );
  });
  it('login --no-wait and logout', async () => {
    const r = await run(
      ['login', '--no-wait', '--json'],
      (s) =>
        s.auth.startDeviceAuthorization.mockResolvedValue({
          deviceCode: 'D'.repeat(43),
          userCode: 'BCDF-GHJK',
          verificationUri: 'https://console.storeshot.art/device',
          verificationUriComplete: 'https://console.storeshot.art/device?code=BCDF-GHJK',
          expiresIn: 600,
          interval: 5,
        }),
      {},
    );
    expect(r.code).toBe(0);
    expect(checked('login', r.stdout).data.status).toBe('pending');
    await expect(normalise(JSON.stringify(JSON.parse(r.stdout), null, 2))).toMatchFileSnapshot(
      '__snapshots__/json/login.json',
    );
    const l = await run(['logout', '--json'], () => {}, {});
    expect(checked('logout', l.stdout).data.removed).toEqual([]);
    await expect(normalise(JSON.stringify(JSON.parse(l.stdout), null, 2))).toMatchFileSnapshot(
      '__snapshots__/json/logout.json',
    );
  });
});

describe('failures are still one valid document', () => {
  it('unknown command → 2 (envelope schema)', async () => {
    const r = await run(['frobnicate', '--json']);
    expect(r.code).toBe(2);
    expect(checked('envelope', r.stdout).error.code).toBe('USAGE');
  });
  it('no key → 3 NOT_LOGGED_IN', async () => {
    const r = await run(['credits', '--json'], () => {}, {});
    expect(r.code).toBe(3);
    expect(checked('credits', r.stdout).error.code).toBe('NOT_LOGGED_IN');
  });
  it('a partial set → 9 with data', async () => {
    const r = await run(['status', SET_ID, '--json'], (s) =>
      s.screenshotSets.get.mockResolvedValue(set('partially_failed')),
    );
    expect(r.code).toBe(9);
    expect(checked('status', r.stdout).data.status).toBe('partially_failed');
  });
  it('--api-key warns and is never printed', async () => {
    const r = await run(
      ['credits', '--api-key', KEY, '--json'],
      (s) =>
        s.credits.get.mockResolvedValue({
          balances: { starter: 0, subscription: 0, purchased: 0 },
          total: 0,
        }),
      {},
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('prefer STORESHOT_API_KEY');
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });
  it('bare storeshot prints help and exits 2; --version prints the version', async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(['--version'])).stdout).toBe('0.0.0-dev\n');
  });
  it('a 401 with a stored key forgets it', async () => {
    const env = { XDG_CONFIG_HOME: path.join(home, 'config401') };
    const { CredentialStore } = await import('@storeshot/mcp-src/auth/store.js');
    const store = new CredentialStore(
      path.join(home, 'config401', 'storeshot', 'cli-credentials.json'),
      () => {},
    );
    store.write({
      baseUrl: 'https://api.storeshot.art/v1',
      environment: 'test',
      apiKey: KEY,
      keyId: 'k',
      scopes: [],
      createdAt: '2026-11-03T10:00:00.000Z',
    });
    const { StoreshotError } = await import('@draggable/storeshot-sdk');
    const r = await run(
      ['credits', '--json'],
      (s) =>
        s.credits.get.mockRejectedValue(
          new StoreshotError({ code: 'UNAUTHORIZED', message: 'revoked', status: 401 }),
        ),
      env,
    );
    expect(r.code).toBe(3);
    expect(store.read('https://api.storeshot.art/v1', 'test')).toBeNull();
  });
});
