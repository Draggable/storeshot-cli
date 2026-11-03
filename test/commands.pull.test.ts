import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { makeZip } from '@storeshot/mcp-test/helpers/zip.js';
import { afterAll, describe, expect, it } from 'vitest';
import { pull } from '../src/commands/pull.js';
import { status } from '../src/commands/status.js';
import { SET_ID, generation, set } from './helpers/fixtures.js';
import { testCtx } from './helpers/ctx.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('pull');
afterAll(() => rmSync(home, { recursive: true, force: true }));
const env = { STORESHOT_API_KEY: 'ss_test_' + 'z'.repeat(32) };
const IMG = 'fastlane/screenshots/en-US/01_app_store_1290x2796.png';
const zip = (complete: boolean) =>
  makeZip([
    { name: IMG, data: 'PNG1' },
    {
      name: 'manifest.json',
      data: JSON.stringify({
        complete,
        files: [{ path: IMG, store: 'app_store', device: 'app_store_1290x2796', position: 1 }],
        missing: complete
          ? []
          : [
              {
                store: 'google_play',
                device: 'google_play_1080x2160',
                position: 1,
                status: 'failed',
                errorCode: 'GENERATION_FAILED',
              },
            ],
      }),
    },
  ]);
const stream = (b: Buffer) => Readable.toWeb(Readable.from([b])) as ReadableStream<Uint8Array>;
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e as { code: string }).code,
  );

describe('pull', () => {
  it('fastlane: writes the archive under the project root, never manifest.json', async () => {
    const t = testCtx(['pull', SET_ID, '--layout', 'fastlane', '--out', 'proj'], { home, env });
    t.sdk.screenshotSets.get.mockResolvedValue(set('succeeded'));
    t.sdk.screenshotSets.archiveStream.mockResolvedValue(stream(zip(true)));
    const r = await pull(t.ctx);
    expect(t.sdk.screenshotSets.archiveStream).toHaveBeenCalledWith(
      SET_ID,
      expect.objectContaining({ layout: 'fastlane' }),
    );
    expect(readFileSync(path.join(home, 'proj', IMG), 'utf8')).toBe('PNG1');
    expect(existsSync(path.join(home, 'proj', 'manifest.json'))).toBe(false);
    expect(r.data).toMatchObject({
      kind: 'screenshot_set',
      layout: 'fastlane',
      complete: true,
      files: [{ relativePath: IMG, store: 'app_store', position: 1 }],
    });
    expect(r.human.join('\n')).toContain('fastlane deliver');
  });
  it('an existing file is FILE_EXISTS (nothing written) unless --force', async () => {
    const dir = path.join(home, 'exists');
    mkdirSync(path.dirname(path.join(dir, IMG)), { recursive: true });
    writeFileSync(path.join(dir, IMG), 'OLD');
    const a = testCtx(['pull', SET_ID, '--layout', 'fastlane', '--out', 'exists'], { home, env });
    a.sdk.screenshotSets.get.mockResolvedValue(set('succeeded'));
    a.sdk.screenshotSets.archiveStream.mockResolvedValue(stream(zip(true)));
    expect(await code(pull(a.ctx))).toBe('FILE_EXISTS');
    expect(readFileSync(path.join(dir, IMG), 'utf8')).toBe('OLD');
    const b = testCtx(['pull', SET_ID, '--layout', 'fastlane', '--out', 'exists', '--force'], {
      home,
      env,
    });
    b.sdk.screenshotSets.get.mockResolvedValue(set('succeeded'));
    b.sdk.screenshotSets.archiveStream.mockResolvedValue(stream(zip(true)));
    await pull(b.ctx);
    expect(readFileSync(path.join(dir, IMG), 'utf8')).toBe('PNG1');
  });
  it('refuses --out inside fastlane/ before any request', async () => {
    const t = testCtx(
      ['pull', SET_ID, '--layout', 'fastlane', '--out', 'proj/fastlane/screenshots'],
      { home, env },
    );
    expect(await code(pull(t.ctx))).toBe('USAGE');
    expect(t.sdk.screenshotSets.get).not.toHaveBeenCalled();
  });
  it('not final yet → NOT_READY; partial → PARTIAL_FAILURE with the data', async () => {
    const a = testCtx(['pull', SET_ID, '--out', 'nr'], { home, env });
    a.sdk.screenshotSets.get.mockResolvedValue(set('running'));
    expect(await code(pull(a.ctx))).toBe('NOT_READY');
    const b = testCtx(['pull', SET_ID, '--layout', 'fastlane', '--out', 'partial'], { home, env });
    b.sdk.screenshotSets.get.mockResolvedValue(set('partially_failed'));
    b.sdk.screenshotSets.archiveStream.mockResolvedValue(stream(zip(false)));
    await expect(pull(b.ctx)).rejects.toMatchObject({
      code: 'PARTIAL_FAILURE',
      opts: { data: { complete: false, missing: [{ device: 'google_play_1080x2160' }] } },
    });
    expect(existsSync(path.join(home, 'partial', IMG))).toBe(true);
  });
});

describe('status', () => {
  it('a running job is not a failure without --wait', async () => {
    const t = testCtx(['status', SET_ID], { home, env });
    t.sdk.screenshotSets.get.mockResolvedValue(set('running'));
    expect((await status(t.ctx)).data).toMatchObject({
      kind: 'screenshot_set',
      status: 'running',
      final: false,
      generation: null,
    });
  });
  it('a failed generation is PARTIAL_FAILURE', async () => {
    const t = testCtx(['status', SET_ID, '--kind', 'generation'], { home, env });
    t.sdk.generations.get.mockResolvedValue(generation('failed'));
    expect(await code(status(t.ctx))).toBe('PARTIAL_FAILURE');
  });
});
