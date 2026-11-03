import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PAGES_FIXTURES, readPagesFile, validatePages } from '../../src/capture/pages.js';
import { tmpDir } from '../helpers/tmp.js';

const dir = tmpDir('pages');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const verdict = (v: unknown) => {
  try {
    validatePages(v);
    return true;
  } catch {
    return false;
  }
};

describe('pages.json (spec §9.2)', () => {
  it('fixtures', () => {
    for (const v of PAGES_FIXTURES.valid) expect(verdict(v), JSON.stringify(v)).toBe(true);
    for (const v of PAGES_FIXTURES.invalid) expect(verdict(v), JSON.stringify(v)).toBe(false);
  });
  it('returns the pages', () => {
    expect(validatePages({ pages: [{ path: '/', name: '01-map', delayMs: 0 }] })).toEqual([
      { path: '/', name: '01-map', delayMs: 0 },
    ]);
  });
  it('reads a file; bad JSON and missing files are USAGE', async () => {
    const ok = path.join(dir, 'pages.json');
    writeFileSync(ok, JSON.stringify({ pages: [{ path: '/settings', caption: 'Settings' }] }));
    expect(await readPagesFile(ok)).toEqual([{ path: '/settings', caption: 'Settings' }]);
    writeFileSync(path.join(dir, 'bad.json'), '{');
    await expect(readPagesFile(path.join(dir, 'bad.json'))).rejects.toMatchObject({
      code: 'USAGE',
    });
    await expect(readPagesFile(path.join(dir, 'none.json'))).rejects.toMatchObject({
      code: 'USAGE',
    });
  });
});
