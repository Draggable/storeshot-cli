// Helpers of the built-bin tests (plain ESM, Node 18 compatible). A local fake API only.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** check-package.mjs points this at the copy installed from the packed tarball. */
export const BIN = process.env.STORESHOT_CLI_BIN ?? path.join(CLI_ROOT, 'dist/bin.js');
if (!existsSync(BIN)) throw new Error(`${BIN} does not exist: run \`npm run build\` first`);
export const PKG = JSON.parse(readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
export const SET_ID = '5c1e0000-0000-4000-8000-000000000001';
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

export function tmp(prefix) {
  const root = path.join(CLI_ROOT, '.tmp');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, `${prefix}-`));
}

/** schemas/*.json by name (for Ajv in the tests). */
export function schemas() {
  const dir = path.join(CLI_ROOT, 'schemas');
  return Object.fromEntries(
    readdirSync(dir).map((f) => [
      f.replace(/(\.schema)?\.json$/, ''),
      JSON.parse(readFileSync(path.join(dir, f), 'utf8')),
    ]),
  );
}

const ENVELOPE_404 = { error: { code: 'NOT_FOUND', message: 'no', requestId: 'r', docUrl: 'x' } };

/** A fake /v1: device start, a set that stays running, a live quote with enough credits. */
export function fakeApi() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      const json = (status, value) =>
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
      const url = req.url ?? '';
      if (url === '/v1/auth/device') {
        return json(200, {
          device_code: 'D'.repeat(43),
          user_code: 'BCDF-GHJK',
          verification_uri: 'https://console.storeshot.art/device',
          verification_uri_complete: 'https://console.storeshot.art/device?code=BCDF-GHJK',
          expires_in: 600,
          interval: 5,
        });
      }
      if (url === '/v1/credits')
        return json(200, { balances: { starter: 10, subscription: 0, purchased: 0 }, total: 10 });
      if (url.startsWith('/v1/devices')) {
        return json(200, {
          data: [
            {
              id: 'app_store_1290x2796',
              store: 'app_store',
              kind: 'screenshot',
              label: 'iPhone',
              deviceHint: 'x',
              width: 1290,
              height: 2796,
              orientations: ['portrait'],
            },
          ],
        });
      }
      if (url === '/v1/uploads') return json(201, { id: '6f1c1f0e-8a5e-4b8e-9a51-0f0e1d2c3b4a' });
      if (url === '/v1/screenshot-sets?dryRun=true') {
        return json(200, {
          dryRun: true,
          environment: 'live',
          images: 1,
          credits: 1,
          availableCredits: 10,
          sufficient: true,
          screens: 1,
          breakdown: [],
        });
      }
      if (url === `/v1/screenshot-sets/${SET_ID}`) {
        return json(200, {
          id: SET_ID,
          status: 'running',
          environment: 'test',
          app: { name: 'T', description: '' },
          images: 2,
          counts: { queued: 1, running: 1, succeeded: 0, failed: 0, canceled: 0 },
          creditsCharged: 0,
          creditsRefunded: 0,
          stores: [{ store: 'app_store', devices: ['app_store_1290x2796'], featureGraphic: null }],
        });
      }
      return json(404, ENVELOPE_404);
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      }),
    ),
  );
}

/** Runs the bin to completion; `onStderr` may act (e.g. send SIGINT) once text appears. */
export function run(args, { env = {}, cwd = CLI_ROOT, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      onStderr?.(stderr, child);
    });
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
