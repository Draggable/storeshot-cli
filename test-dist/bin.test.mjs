// The built bin (spec §15.2): Node 24 and Node 18, against a local fake API only.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { PKG, PNG, SET_ID, fakeApi, run, schemas, tmp } from './helpers.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
const SCHEMAS = schemas();
const one = (name, stdout) => {
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 1, `exactly one JSON document, got: ${stdout}`);
  const doc = JSON.parse(lines[0]);
  const validate = ajv.compile(SCHEMAS[name]);
  assert.ok(validate(doc), JSON.stringify(validate.errors));
  return doc;
};
const KEY_TEST = 'ss_test_' + 't'.repeat(32);
const KEY_LIVE = 'ss_live_' + 'l'.repeat(32);

describe('storeshot (built bin)', () => {
  let api;
  let home;
  let env;
  before(async () => {
    api = await fakeApi();
    home = tmp('bin');
    env = {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, 'config'),
      STORESHOT_BASE_URL: `${api.url}/v1`,
      NO_COLOR: '1',
    };
  });
  after(async () => {
    await api.close();
    rmSync(home, { recursive: true, force: true });
  });

  test('--version, --help, bare', async () => {
    assert.equal((await run(['--version'], { env })).stdout.trim(), PKG.version);
    const help = await run(['--help'], { env });
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Commands:/);
    assert.equal((await run([], { env })).code, 2);
  });

  test('usage error and not logged in: one valid document, no ANSI on stderr', async () => {
    const bad = await run(['frobnicate', '--json'], { env });
    assert.equal(bad.code, 2);
    assert.equal(one('envelope', bad.stdout).error.code, 'USAGE');
    const none = await run(['credits', '--json'], { env });
    assert.equal(none.code, 3);
    assert.equal(one('credits', none.stdout).error.code, 'NOT_LOGGED_IN');
    assert.equal(/\u001b\[/.test(none.stderr), false);
  });

  test('login --no-wait: pending document, 0600 file, environment test sent', async () => {
    const r = await run(['login', '--no-wait', '--json'], { env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(one('login', r.stdout).data.status, 'pending');
    const file = path.join(home, 'config', 'storeshot', 'cli-device.json');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    const start = api.requests.find((q) => q.url === '/v1/auth/device');
    assert.deepEqual(JSON.parse(start.body), { client_name: 'Storeshot CLI', environment: 'test' });
    rmSync(file);
  });

  test('--api-key is never printed', async () => {
    const r = await run(['credits', '--api-key', KEY_TEST, '--json'], { env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal((r.stdout + r.stderr).includes(KEY_TEST), false);
    assert.match(r.stderr, /prefer STORESHOT_API_KEY/);
    one('credits', r.stdout);
  });

  test('live set without --yes: CONFIRMATION_REQUIRED (11), nothing created', async () => {
    const dir = path.join(home, 'shots');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '01.png'), PNG);
    writeFileSync(
      path.join(dir, 'captions.json'),
      JSON.stringify({ app: { name: 'T' }, screens: [{ file: '01.png', caption: 'Hi' }] }),
    );
    const r = await run(['set', dir, '--store', 'app_store', '--json'], {
      env: { ...env, STORESHOT_API_KEY: KEY_LIVE },
    });
    assert.equal(r.code, 11, r.stderr);
    const doc = one('set', r.stdout);
    assert.equal(doc.error.code, 'CONFIRMATION_REQUIRED');
    assert.equal(doc.data.quote.credits, 1);
    assert.equal(
      api.requests.some((q) => q.method === 'POST' && q.url === '/v1/screenshot-sets'),
      false,
    );
  });

  test('Ctrl-C while waiting: exit 130, INTERRUPTED with the id, the job is not canceled', async () => {
    const r = await run(['status', SET_ID, '--wait', '--json'], {
      env: { ...env, STORESHOT_API_KEY: KEY_TEST },
      onStderr: (text, child) => {
        if (text.includes('Screenshot set') && !child.killed) child.kill('SIGINT');
      },
    });
    assert.equal(r.code, 130, r.stderr);
    const doc = one('status', r.stdout);
    assert.equal(doc.error.code, 'INTERRUPTED');
    assert.equal(doc.error.details.id, SET_ID);
    assert.match(r.stderr, new RegExp(`storeshot status ${SET_ID}`));
    assert.equal(
      api.requests.some((q) => q.url.endsWith('/cancel')),
      false,
    );
  });
});
