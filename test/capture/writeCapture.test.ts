import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertFree, openFolder, writeCapture } from '../../src/capture/writeCapture.js';
import { tmpDir } from '../helpers/tmp.js';
import { makePng } from './shims/png.mjs';

const root = tmpDir('write');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('writeCapture (spec §11)', () => {
  it('openFolder creates and resolves the folder', async () => {
    const folder = await openFolder(path.join(root, 'a', 'screens'));
    expect(existsSync(folder)).toBe(true);
  });
  it('writes PNGs and captions.json', async () => {
    const folder = await openFolder(path.join(root, 'b'));
    const written = await writeCapture(
      folder,
      [{ name: '01.png', data: makePng(400, 800) }],
      '{"screens":[]}\n',
      false,
    );
    expect(written.map((w) => w.relativePath)).toEqual(['01.png']);
    expect(readFileSync(path.join(folder, 'captions.json'), 'utf8')).toBe('{"screens":[]}\n');
  });
  it('assertFree: FILE_EXISTS unless --force', async () => {
    const folder = await openFolder(path.join(root, 'c'));
    writeFileSync(path.join(folder, '01.png'), 'x');
    await expect(assertFree(folder, ['01.png', '02.png'], false)).rejects.toMatchObject({
      code: 'FILE_EXISTS',
      opts: { details: { files: [path.join(folder, '01.png')] } },
    });
    await expect(assertFree(folder, ['01.png'], true)).resolves.toBeUndefined();
  });
  it('rolls the PNGs back when captions.json cannot be written', async () => {
    const folder = await openFolder(path.join(root, 'd'));
    mkdirSync(path.join(folder, 'captions.json')); // a folder where the file should go
    await expect(
      writeCapture(folder, [{ name: '01.png', data: makePng(400, 800) }], '{}\n', false),
    ).rejects.toBeTruthy();
    expect(readdirSync(folder)).toEqual(['captions.json']);
  });
});
