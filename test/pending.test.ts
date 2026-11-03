import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PendingStore, type PendingCode } from '../src/pending.js';
import { tmpDir } from './helpers/tmp.js';

const root = tmpDir('pending');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const NOW = Date.parse('2026-11-03T10:00:00.000Z');
const code = (over: Partial<PendingCode> = {}): PendingCode => ({
  baseUrl: 'https://api.storeshot.art/v1',
  environment: 'test',
  deviceCode: 'D'.repeat(43),
  userCode: 'BCDF-GHJK',
  verificationUri: 'https://console.storeshot.art/device',
  verificationUriComplete: 'https://console.storeshot.art/device?code=BCDF-GHJK',
  interval: 5,
  expiresAt: '2026-11-03T10:10:00.000Z',
  ...over,
});

describe('PendingStore', () => {
  it('writes 0600 in a 0700 folder and reads back the matching entry', () => {
    const file = path.join(root, 'a', 'storeshot', 'cli-device.json');
    const store = new PendingStore(file, () => {});
    store.write(code());
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
    expect(store.read('https://api.storeshot.art/v1', 'test', NOW)).toEqual(code());
    expect(store.read('https://api.storeshot.art/v1', 'live', NOW)).toBeNull();
    expect(store.read('http://127.0.0.1:1/v1', 'test', NOW)).toBeNull();
  });
  it('an expired code is deleted and not returned', () => {
    const file = path.join(root, 'b', 'cli-device.json');
    const store = new PendingStore(file, () => {});
    store.write(code({ expiresAt: '2026-11-03T09:59:59.000Z' }));
    expect(store.read('https://api.storeshot.art/v1', 'test', NOW)).toBeNull();
    expect(existsSync(file)).toBe(false);
  });
  it('ignores (with a warning) a file other users can read', () => {
    if (process.platform === 'win32') return;
    const dir = path.join(root, 'c');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'cli-device.json');
    writeFileSync(file, JSON.stringify({ version: 1, pending: code() }));
    chmodSync(file, 0o644);
    const warnings: string[] = [];
    expect(
      new PendingStore(file, (w) => warnings.push(w)).read(
        'https://api.storeshot.art/v1',
        'test',
        NOW,
      ),
    ).toBeNull();
    expect(warnings.join()).toContain('readable by other users');
  });
  it('clear() removes the file; clearing twice is fine', () => {
    const file = path.join(root, 'd', 'cli-device.json');
    const store = new PendingStore(file, () => {});
    store.write(code());
    store.clear();
    store.clear();
    expect(existsSync(file)).toBe(false);
  });
});
