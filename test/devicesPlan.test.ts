import { describe, expect, it } from 'vitest';
import { planStores } from '../src/devicesPlan.js';
import { DEVICES } from './helpers/fixtures.js';

const cat = DEVICES.data as never;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'ok';
};

describe('planStores (spec §8.7)', () => {
  it('assigns devices to their stores; a store without devices gets its defaults', () => {
    expect(
      planStores({ stores: ['app_store', 'google_play'], devices: ['app_store_1179x2556'] }, cat)
        .stores,
    ).toEqual([{ store: 'app_store', devices: ['app_store_1179x2556'] }, { store: 'google_play' }]);
  });
  it('stores come from the devices when --store is absent', () => {
    expect(planStores({ stores: [], devices: ['google_play_1080x2160'] }, cat).stores).toEqual([
      { store: 'google_play', devices: ['google_play_1080x2160'] },
    ]);
  });
  it('the feature graphic goes to google_play only', () => {
    expect(
      planStores({ stores: ['google_play'], devices: [], featureGraphic: true }, cat).stores,
    ).toEqual([{ store: 'google_play', featureGraphic: true }]);
    expect(
      code(() => planStores({ stores: ['app_store'], devices: [], featureGraphic: true }, cat)),
    ).toBe('USAGE');
  });
  it('errors: nothing given, unknown id, device of another store, more than 5', () => {
    expect(code(() => planStores({ stores: [], devices: [] }, cat))).toBe('USAGE');
    expect(code(() => planStores({ stores: ['app_store'], devices: ['app_store_1x1'] }, cat))).toBe(
      'USAGE',
    );
    expect(
      code(() => planStores({ stores: ['app_store'], devices: ['google_play_1080x2160'] }, cat)),
    ).toBe('USAGE');
    expect(code(() => planStores({ stores: ['steam'], devices: [] }, cat))).toBe('USAGE');
  });
  it('a deprecated device is kept with a warning naming its replacement', () => {
    const p = planStores({ stores: ['google_play'], devices: ['google_play_1080x2400'] }, cat);
    expect(p.warnings).toEqual(['google_play_1080x2400 is deprecated: use google_play_1080x2160.']);
  });
});
