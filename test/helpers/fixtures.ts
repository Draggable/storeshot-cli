export const SET_ID = '5c1e0000-0000-4000-8000-000000000001';
export const GEN_ID = '0b8e0000-0000-4000-8000-000000000001';
export const UPLOAD_ID = '6f1c1f0e-8a5e-4b8e-9a51-0f0e1d2c3b4a';

export const generation = (status: string, extra: Record<string, unknown> = {}) => ({
  id: GEN_ID,
  status,
  environment: 'test',
  inputs: [{ uploadId: UPLOAD_ID, sourceUrl: null }],
  store: 'app_store',
  device: 'app_store_1290x2796',
  size: { width: 1290, height: 2796 },
  caption: null,
  creditsCharged: 0,
  creditsRefunded: 0,
  error: status === 'failed' ? { code: 'GENERATION_FAILED', message: 'failed' } : null,
  result:
    status === 'succeeded'
      ? {
          image: {
            url: 'https://s.example.com/1.png',
            contentType: 'image/png',
            width: 1290,
            height: 2796,
          },
        }
      : null,
  createdAt: '2026-11-03T10:00:00.000Z',
  ...extra,
});

export const counts = (
  c: Partial<Record<'queued' | 'running' | 'succeeded' | 'failed' | 'canceled', number>>,
) => ({
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  ...c,
});

export const set = (status: string, extra: Record<string, unknown> = {}) => ({
  id: SET_ID,
  status,
  environment: 'test',
  app: { name: 'Trailmate', description: '' },
  images: 4,
  counts: counts(
    status === 'succeeded'
      ? { succeeded: 4 }
      : status === 'partially_failed'
        ? { succeeded: 3, failed: 1 }
        : { queued: 4 },
  ),
  creditsCharged: 0,
  creditsRefunded: 0,
  stores: [
    { store: 'app_store', devices: ['app_store_1290x2796'], featureGraphic: null },
    {
      store: 'google_play',
      devices: ['google_play_1080x2160'],
      featureGraphic: { screen: 1, caption: 'x' },
    },
  ],
  ...extra,
});

export const quote = (extra: Record<string, unknown> = {}) => ({
  dryRun: true,
  environment: 'test',
  images: 5,
  credits: 0,
  availableCredits: 0,
  sufficient: true,
  screens: 2,
  breakdown: [
    {
      store: 'app_store',
      device: 'app_store_1290x2796',
      size: { width: 1290, height: 2796 },
      orientation: 'portrait',
      images: 2,
      defaulted: false,
    },
  ],
  ...extra,
});

export const DEVICES = {
  data: [
    {
      id: 'app_store_1290x2796',
      store: 'app_store',
      kind: 'screenshot',
      label: 'iPhone 6.9"',
      deviceHint: 'x',
      width: 1290,
      height: 2796,
      orientations: ['portrait', 'landscape'],
    },
    {
      id: 'app_store_1179x2556',
      store: 'app_store',
      kind: 'screenshot',
      label: 'iPhone 6.3"',
      deviceHint: 'x',
      width: 1179,
      height: 2556,
      orientations: ['portrait', 'landscape'],
    },
    {
      id: 'google_play_1080x2160',
      store: 'google_play',
      kind: 'screenshot',
      label: 'Phone',
      deviceHint: 'x',
      width: 1080,
      height: 2160,
      orientations: ['portrait', 'landscape'],
    },
    {
      id: 'google_play_1080x2400',
      store: 'google_play',
      kind: 'screenshot',
      label: 'Phone',
      deviceHint: 'x',
      width: 1080,
      height: 2400,
      orientations: ['portrait', 'landscape'],
      deprecated: true,
      replacedBy: 'google_play_1080x2160',
    },
    {
      id: 'google_play_1024x500',
      store: 'google_play',
      kind: 'feature_graphic',
      label: 'Feature graphic',
      deviceHint: 'x',
      width: 1024,
      height: 500,
      orientations: ['landscape'],
    },
  ],
};
