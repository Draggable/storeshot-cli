// SS-023 §16.3: the built bin with the fake tools: one capture, and the status bar restore on
// SIGINT and SIGTERM (the signal is sent once the fake tool shows the hanging call; no sleeps).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { installShims } from '../test/capture/shims/install.mjs';
import { makePng } from '../test/capture/shims/png.mjs';
import { BIN, schemas, tmp } from './helpers.mjs';

const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schemas().capture);
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(scenario, png) {
  const shims = installShims({ png, scenario });
  const cwd = tmp('capture');
  dirs.push(shims.dir, cwd);
  return { shims, cwd };
}
function start(args, { shims, cwd }) {
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...shims.env, NO_COLOR: '1', XDG_CONFIG_HOME: path.join(cwd, 'config') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((resolve) =>
    child.on('close', (code) => resolve({ code, stdout, stderr })),
  );
  return { child, done };
}
async function until(check, ms = 15_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for the fake tool');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const one = (stdout) => {
  const doc = JSON.parse(stdout);
  assert.ok(validate(doc), JSON.stringify(validate.errors));
  return doc;
};

describe('storeshot capture (built bin, fake tools)', () => {
  test('dist/bin.js never imports playwright (spec §9.1)', () => {
    assert.doesNotMatch(
      readFileSync(BIN, 'utf8'),
      /from ["']playwright|import\(["']playwright|require\(["']playwright/,
    );
  });

  test('capture ios --json: one schema-valid document, files in screens/', async () => {
    const s = setup([], makePng(1206, 2622));
    const r = await start(['capture', 'ios', '--offline', '--json'], s).done;
    assert.equal(r.code, 0, r.stderr);
    assert.equal(one(r.stdout).data.screens[0].file, '01.png');
    assert.deepEqual(readdirSync(path.join(s.cwd, 'screens')).sort(), ['01.png', 'captions.json']);
  });

  for (const [signal, exit] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    test(`ios ${signal} during the screenshot: exit ${exit}, status bar restored, nothing left`, async () => {
      const s = setup(['screenshot-hangs'], makePng(1206, 2622));
      const run = start(
        ['capture', 'ios', '--clean-status-bar', '--settle', '0', '--offline', '--json'],
        s,
      );
      await until(() => s.shims.calls().some((c) => c.argv[1] === 'io'));
      run.child.kill(signal);
      const r = await run.done;
      assert.equal(r.code, exit, r.stderr);
      const doc = one(r.stdout);
      assert.equal(doc.error.code, 'INTERRUPTED');
      assert.match(doc.error.message, /Nothing was written\. Status bar restored\./);
      const subs = s.shims.calls().map((c) => `${c.argv[1]} ${c.argv.at(-1)}`);
      assert.ok(
        subs.indexOf('status_bar clear') > subs.findIndex((x) => x.startsWith('io ')),
        subs.join('\n'),
      );
      assert.deepEqual(readdirSync(path.join(s.cwd, 'screens')), []);
      assert.match(r.stderr, /Restoring the status bar \(Ctrl-C again skips it\)/);
    });
  }

  test('android SIGINT during screencap: demo mode exited and the earlier value put back', async () => {
    const s = setup(['screencap-hangs', 'demo-0'], makePng(1080, 2400));
    const run = start(
      ['capture', 'android', '--clean-status-bar', '--settle', '0', '--offline', '--json'],
      s,
    );
    await until(() => s.shims.calls().some((c) => c.argv.includes('screencap')));
    run.child.kill('SIGINT');
    const r = await run.done;
    assert.equal(r.code, 130, r.stderr);
    const words = s.shims.calls().map((c) => c.argv.join(' '));
    assert.match(words.at(-2), /-e command exit$/);
    assert.equal(words.at(-1), '-s emulator-5554 shell settings put global sysui_demo_allowed 0');
  });
});
