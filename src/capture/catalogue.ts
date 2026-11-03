import type { Schemas } from '@draggable/storeshot-sdk';
import { CliError } from '../errors.js';

export type Device = Schemas['Device'];
export type Orientation = 'portrait' | 'landscape';
export type CatalogueSource = 'api' | 'bundled';

function dev(
  store: Device['store'],
  width: number,
  height: number,
  label: string,
  deviceHint: string,
): Device {
  return {
    id: `${store}_${width}x${height}`,
    store,
    kind: 'screenshot',
    label,
    deviceHint,
    width,
    height,
    orientations: ['portrait', 'landscape'],
  };
}

/**
 * SS-023 spec §6.1: buildPlatformDeviceCatalogue() of contract 1.17.0, used when no key is at hand,
 * the API is unreachable or --offline is set. Pinned by test/monorepo/catalogueParity.test.ts.
 */
export const BUNDLED_DEVICES: Device[] = [
  dev('app_store', 1284, 2778, 'iPhone 6.5"', 'iPhone 14 Pro Max / 11 Pro Max'),
  dev('app_store', 1290, 2796, 'iPhone 6.9"', 'iPhone 15/16 Pro Max'),
  dev('app_store', 1179, 2556, 'iPhone 6.1"/6.3"', 'iPhone 15/16 Pro'),
  dev('app_store', 2064, 2752, 'iPad 13"', 'iPad Pro 13" (M4)'),
  dev('app_store', 1668, 2388, 'iPad 11"', 'iPad Air / Pro 11"'),
  {
    id: 'google_play_1024x500',
    store: 'google_play',
    kind: 'feature_graphic',
    label: 'Google Play Feature Image',
    deviceHint: 'Google Play feature graphic banner',
    width: 1024,
    height: 500,
    orientations: ['landscape'],
  },
  dev('google_play', 1080, 1920, 'Phone (9:16)', 'Google Pixel 8'),
  {
    ...dev('google_play', 1080, 2400, 'Phone (9:20)', 'Samsung Galaxy S24'),
    deprecated: true,
    replacedBy: 'google_play_1080x2160',
  },
  dev('google_play', 1080, 2160, 'Phone (9:18)', 'Modern tall phones'),
  dev('google_play', 1200, 1920, 'Tablet 7"', 'Generic 7" Tablet'),
  dev('google_play', 1600, 2560, 'Tablet 10"', 'Pixel Tablet'),
];

/** Spec §6.2: phones DPR 3, tablets DPR 2, so layouts see the CSS widths real devices report. */
export const WEB_PRESETS: Readonly<Record<string, { dpr: 2 | 3 }>> = {
  app_store_1284x2778: { dpr: 3 },
  app_store_1290x2796: { dpr: 3 },
  app_store_1179x2556: { dpr: 3 },
  app_store_2064x2752: { dpr: 2 },
  app_store_1668x2388: { dpr: 2 },
  google_play_1080x1920: { dpr: 3 },
  google_play_1080x2400: { dpr: 3 },
  google_play_1080x2160: { dpr: 3 },
  google_play_1200x1920: { dpr: 2 },
  google_play_1600x2560: { dpr: 2 },
};
export const DEFAULT_WEB_DEVICE = 'app_store_1290x2796';

export interface Preset {
  device: string;
  store: Device['store'];
  width: number;
  height: number;
  orientation: Orientation;
  viewport: { width: number; height: number } | null;
  deviceScaleFactor: number | null;
  source: CatalogueSource;
}

/** Spec §6.2: for a device id the API knows but this CLI does not. */
export function fallbackDpr(width: number, height: number): number {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short % 3 === 0 && long % 3 === 0 && short / 3 < 600) return 3;
  if (short % 2 === 0 && long % 2 === 0) return 2;
  return 1;
}

export function findScreenshotDevice(
  devices: Device[],
  id: string,
  warn: (m: string) => void,
): Device {
  const d = devices.find((x) => x.id === id);
  if (!d) {
    throw new CliError('USAGE', `Unknown device "${id}".`, {
      hint: 'storeshot devices lists the ids.',
    });
  }
  if (d.kind !== 'screenshot') {
    throw new CliError(
      'USAGE',
      `${id} is the Google Play feature graphic: Storeshot builds it from a screen, so it is not a capture size.`,
    );
  }
  if (d.deprecated) warn(`${id} is deprecated: use ${d.replacedBy}.`);
  return d;
}

export function presetFor(
  d: Device,
  orientation: Orientation,
  source: CatalogueSource,
  web: boolean,
  warn: (m: string) => void,
): Preset {
  const landscape = orientation === 'landscape';
  const width = landscape ? d.height : d.width;
  const height = landscape ? d.width : d.height;
  const base = { device: d.id, store: d.store, width, height, orientation, source };
  if (!web) return { ...base, viewport: null, deviceScaleFactor: null };
  let dpr: number | undefined = WEB_PRESETS[d.id]?.dpr;
  if (!dpr) {
    dpr = fallbackDpr(d.width, d.height);
    warn(`No viewport preset for ${d.id} in this CLI: using device pixel ratio ${dpr}.`);
  }
  return {
    ...base,
    viewport: { width: width / dpr, height: height / dpr },
    deviceScaleFactor: dpr,
  };
}

const sameSize = (d: { width: number; height: number }, w: number, h: number) =>
  Math.min(d.width, d.height) === Math.min(w, h) && Math.max(d.width, d.height) === Math.max(w, h);

/** Spec §6.3: the screenshot device of this size (either orientation), non-deprecated first. */
export function matchDevice(devices: Device[], width: number, height: number): string | null {
  const shots = devices.filter((d) => d.kind === 'screenshot' && sameSize(d, width, height));
  return (shots.find((d) => !d.deprecated) ?? shots[0])?.id ?? null;
}

export function presetMatches(preset: Preset, width: number, height: number): boolean {
  return sameSize(preset, width, height);
}
