import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CAPTION_FIXTURES, readCaptions, validateCaptions } from '../src/captions.js';
import { tmpDir } from './helpers/tmp.js';

const dir = tmpDir('captions');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const verdict = (v: unknown) => {
  try {
    validateCaptions(v);
    return 'ok';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('validateCaptions (spec §8.6)', () => {
  it('accepts every valid fixture and rejects every invalid one', () => {
    for (const v of CAPTION_FIXTURES.valid) expect(verdict(v)).toBe('ok');
    for (const v of CAPTION_FIXTURES.invalid)
      expect([JSON.stringify(v), verdict(v)]).toEqual([JSON.stringify(v), 'USAGE']);
  });
  it('file names are plain names inside the folder', () => {
    for (const file of ['../x.png', 'a/b.png', 'a\\b.png', '.hidden.png', '', 'x'.repeat(129)])
      expect(verdict({ screens: [{ file, caption: 'c' }] })).toBe('USAGE');
    expect(verdict({ screens: [{ file: '01 Home.png', caption: 'c' }] })).toBe('ok');
  });
  it('the message names the path of the problem', () => {
    expect(() => validateCaptions({ screens: [{ file: 'a.png', caption: '' }] })).toThrow(
      /screens\[0\]\.caption/,
    );
  });
});

describe('readCaptions', () => {
  it('reads a regular file of at most 1 MiB', async () => {
    const ok = path.join(dir, 'captions.json');
    writeFileSync(ok, JSON.stringify({ screens: [{ file: 'a.png', caption: 'Hi' }] }));
    expect((await readCaptions(ok)).screens).toEqual([{ file: 'a.png', caption: 'Hi' }]);
    const big = path.join(dir, 'big.json');
    writeFileSync(big, ' '.repeat(1024 * 1024 + 1));
    await expect(readCaptions(big)).rejects.toMatchObject({ code: 'USAGE' });
    await expect(readCaptions(path.join(dir, 'missing.json'))).rejects.toMatchObject({
      code: 'USAGE',
    });
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{nope');
    await expect(readCaptions(bad)).rejects.toMatchObject({ code: 'USAGE' });
  });
});
