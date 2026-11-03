import { describe, expect, it } from 'vitest';
import {
  BUNDLED_DEVICES,
  DEFAULT_WEB_DEVICE,
  WEB_PRESETS,
  fallbackDpr,
  findScreenshotDevice,
  matchDevice,
  presetFor,
} from '../../src/capture/catalogue.js';

const warnings: string[] = [];
const warn = (m: string) => warnings.push(m);
const device = (id: string) => BUNDLED_DEVICES.find((d) => d.id === id)!;

describe('catalogue (SS-023 spec §6)', () => {
  it('every screenshot device has a web preset with integer CSS sizes', () => {
    const shots = BUNDLED_DEVICES.filter((d) => d.kind === 'screenshot');
    expect(shots).toHaveLength(10);
    for (const d of shots) {
      const dpr = WEB_PRESETS[d.id]?.dpr;
      expect(dpr, d.id).toBeDefined();
      expect(Number.isInteger(d.width / dpr!) && Number.isInteger(d.height / dpr!), d.id).toBe(
        true,
      );
    }
    expect(Object.keys(WEB_PRESETS).sort()).toEqual(shots.map((d) => d.id).sort());
  });
  it('presetFor: viewport, DPR, landscape swap, non-web has no viewport', () => {
    expect(presetFor(device(DEFAULT_WEB_DEVICE), 'portrait', 'bundled', true, warn)).toEqual({
      device: 'app_store_1290x2796',
      store: 'app_store',
      width: 1290,
      height: 2796,
      orientation: 'portrait',
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 3,
      source: 'bundled',
    });
    expect(
      presetFor(device('google_play_1600x2560'), 'landscape', 'api', true, warn),
    ).toMatchObject({ width: 2560, height: 1600, viewport: { width: 1280, height: 800 } });
    expect(
      presetFor(device('google_play_1200x1920'), 'portrait', 'api', false, warn),
    ).toMatchObject({ viewport: null, deviceScaleFactor: null });
  });
  it('fallback DPR for ids this CLI does not know', () => {
    expect(fallbackDpr(1320, 2868)).toBe(3);
    expect(fallbackDpr(1800, 2880)).toBe(2);
    expect(fallbackDpr(1081, 2401)).toBe(1);
    const unknown = {
      ...device('app_store_1290x2796'),
      id: 'app_store_1320x2868',
      width: 1320,
      height: 2868,
    };
    warnings.length = 0;
    expect(presetFor(unknown, 'portrait', 'api', true, warn).viewport).toEqual({
      width: 440,
      height: 956,
    });
    expect(warnings[0]).toMatch(/No viewport preset for app_store_1320x2868/);
  });
  it('findScreenshotDevice: unknown, feature graphic, deprecated', () => {
    expect(() => findScreenshotDevice(BUNDLED_DEVICES, 'nope', warn)).toThrow(/Unknown device/);
    expect(() => findScreenshotDevice(BUNDLED_DEVICES, 'google_play_1024x500', warn)).toThrow(
      /feature graphic/,
    );
    warnings.length = 0;
    findScreenshotDevice(BUNDLED_DEVICES, 'google_play_1080x2400', warn);
    expect(warnings).toEqual(['google_play_1080x2400 is deprecated: use google_play_1080x2160.']);
  });
  it('matchDevice: orientation-free, prefers non-deprecated, null otherwise', () => {
    expect(matchDevice(BUNDLED_DEVICES, 1290, 2796)).toBe('app_store_1290x2796');
    expect(matchDevice(BUNDLED_DEVICES, 2796, 1290)).toBe('app_store_1290x2796');
    expect(matchDevice(BUNDLED_DEVICES, 1080, 2400)).toBe('google_play_1080x2400');
    expect(matchDevice(BUNDLED_DEVICES, 1206, 2622)).toBeNull();
  });
});
