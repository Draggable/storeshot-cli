import path from 'node:path';
import { StoreshotError } from '@draggable/storeshot-sdk';
import { describe, expect, it } from 'vitest';
import { fetchJob } from '../src/commands/jobs.js';
import {
  checkFastlaneOut,
  checkId,
  outputName,
  parsePalette,
  parseSize,
} from '../src/commands/shared.js';
import { fakeSdk } from './helpers/fakeSdk.js';
import { GEN_ID, generation, set } from './helpers/fixtures.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'ok';
};

describe('value parsers', () => {
  it('palette', () => {
    expect(parsePalette('#1E88E5:Sky, #ffffff:Snow')).toEqual([
      { hex: '#1E88E5', name: 'Sky' },
      { hex: '#ffffff', name: 'Snow' },
    ]);
    expect(code(() => parsePalette('1E88E5:Sky'))).toBe('USAGE');
    expect(code(() => parsePalette('#1E88E5'))).toBe('USAGE');
    expect(code(() => parsePalette(Array.from({ length: 9 }, () => '#000000:x').join(',')))).toBe(
      'USAGE',
    );
  });
  it('size', () => {
    expect(parseSize('1290x2796')).toEqual({ width: 1290, height: 2796 });
    expect(parseSize(undefined)).toBeUndefined();
    expect(code(() => parseSize('big'))).toBe('USAGE');
  });
  it('ids', () => {
    expect(checkId(GEN_ID)).toBe(GEN_ID);
    expect(code(() => checkId('123'))).toBe('USAGE');
  });
  it('output names: NN_<stem>_<device>, safe characters, ≤ 60 stem characters', () => {
    expect(outputName(1, 'home.png', 'app_store_1290x2796')).toBe('01_home_app_store_1290x2796');
    expect(outputName(10, 'Écran d’accueil (1).PNG', 'd')).toBe('10_-cran-d-accueil--1-_d');
    expect(outputName(2, '.png', 'd')).toBe('02_png_d');
    expect(outputName(2, '...', 'd')).toBe('02_image_d');
    expect(outputName(3, `${'a'.repeat(80)}.png`, 'd')).toBe(`03_${'a'.repeat(60)}_d`);
  });
  it('the fastlane --out must be the project root (spec §8.4)', () => {
    const root = path.join(path.sep, 'srv', 'app');
    expect(code(() => checkFastlaneOut(path.join(root, 'fastlane', 'screenshots')))).toBe('USAGE');
    expect(code(() => checkFastlaneOut(path.join(root, 'fastlane')))).toBe('USAGE');
    expect(code(() => checkFastlaneOut(root))).toBe('ok');
  });
});

describe('fetchJob', () => {
  it('tries a set, then a generation on 404', async () => {
    const sdk = fakeSdk();
    sdk.screenshotSets.get.mockRejectedValue(
      new StoreshotError({ code: 'NOT_FOUND', message: 'no', status: 404 }),
    );
    sdk.generations.get.mockResolvedValue(generation('running'));
    expect(
      await fetchJob(sdk as never, GEN_ID, undefined, new AbortController().signal),
    ).toMatchObject({ kind: 'generation' });
  });
  it('--kind skips the other lookup', async () => {
    const sdk = fakeSdk();
    sdk.screenshotSets.get.mockResolvedValue(set('running'));
    await fetchJob(sdk as never, GEN_ID, 'screenshot_set', new AbortController().signal);
    expect(sdk.generations.get).not.toHaveBeenCalled();
  });
});
