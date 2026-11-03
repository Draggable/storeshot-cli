import type {
  Generation,
  Schemas,
  ScreenshotSet,
  ScreenshotSetQuote,
} from '@draggable/storeshot-sdk';
import type { SavedFile, SavedResults } from './shared/mcp.js';

export const GENERATION_FINAL = ['succeeded', 'failed', 'canceled'] as const;
export const SET_FINAL = ['succeeded', 'partially_failed', 'failed', 'canceled'] as const;
export const isFinalGeneration = (status: string) =>
  (GENERATION_FINAL as readonly string[]).includes(status);
export const isFinalSet = (status: string) => (SET_FINAL as readonly string[]).includes(status);

export interface Waited {
  seconds: number;
  timedOut: boolean;
}

export function generationView(
  g: Generation,
  from: { input: string | null; uploadId: string | null },
) {
  return {
    input: from.input,
    uploadId: from.uploadId ?? g.inputs?.[0]?.uploadId ?? null,
    id: g.id,
    status: g.status,
    environment: g.environment,
    store: g.store,
    device: g.device,
    width: g.size.width,
    height: g.size.height,
    creditsCharged: g.creditsCharged,
    creditsRefunded: g.creditsRefunded,
    error: g.error ? { code: g.error.code, message: g.error.message } : null,
  };
}

export function setView(s: ScreenshotSet) {
  return {
    id: s.id,
    status: s.status,
    environment: s.environment,
    appName: s.app.name,
    images: s.images,
    counts: { ...s.counts },
    creditsCharged: s.creditsCharged,
    creditsRefunded: s.creditsRefunded,
    stores: s.stores.map((t) => ({
      store: t.store,
      devices: [...t.devices],
      featureGraphic: t.featureGraphic !== null,
    })),
  };
}

export function quoteView(q: ScreenshotSetQuote) {
  return {
    environment: q.environment,
    images: q.images,
    credits: q.credits,
    availableCredits: q.availableCredits,
    sufficient: q.sufficient,
    screens: q.screens,
    breakdown: q.breakdown.map((b) => ({
      store: b.store,
      device: b.device,
      width: b.size.width,
      height: b.size.height,
      orientation: b.orientation,
      images: b.images,
      defaulted: b.defaulted,
    })),
  };
}

export function deviceView(d: Schemas['Device']) {
  return {
    id: d.id,
    store: d.store,
    kind: d.kind,
    label: d.label,
    width: d.width,
    height: d.height,
    orientations: [...d.orientations],
    deprecated: d.deprecated === true,
    replacedBy: d.replacedBy ?? null,
  };
}

const fileView = (f: SavedFile) => ({
  path: f.path,
  relativePath: f.relativePath,
  bytes: f.bytes,
  sha256: f.sha256,
  store: f.store,
  device: f.device,
  position: f.position,
});

export function pullView(
  saved: SavedResults,
  opts: {
    kind: 'generation' | 'screenshot_set';
    id: string;
    folder: string;
    layout: 'store' | 'fastlane';
  },
) {
  return {
    kind: opts.kind,
    id: opts.id,
    folder: opts.folder,
    layout: opts.layout,
    files: saved.files.map(fileView),
    complete: saved.complete,
    missing: saved.missing.map((m) => ({ ...m })),
  };
}

export function downloadView(folder: string, files: SavedFile[]) {
  return { folder, files: files.map(fileView) };
}
