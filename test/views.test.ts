import { describe, expect, it } from 'vitest';
import { deviceView, generationView, quoteView, setView } from '../src/views.js';
import { DEVICES, generation, quote, set } from './helpers/fixtures.js';

describe('views (exact field picks)', () => {
  it('generationView', () => {
    expect(
      generationView(generation('failed') as never, { input: 'home.png', uploadId: 'u' }),
    ).toEqual({
      input: 'home.png',
      uploadId: 'u',
      id: generation('x').id,
      status: 'failed',
      environment: 'test',
      store: 'app_store',
      device: 'app_store_1290x2796',
      width: 1290,
      height: 2796,
      creditsCharged: 0,
      creditsRefunded: 0,
      error: { code: 'GENERATION_FAILED', message: 'failed' },
    });
  });
  it('setView turns featureGraphic into a boolean', () => {
    const v = setView(set('succeeded') as never);
    expect(v.stores).toEqual([
      { store: 'app_store', devices: ['app_store_1290x2796'], featureGraphic: false },
      { store: 'google_play', devices: ['google_play_1080x2160'], featureGraphic: true },
    ]);
    expect(Object.keys(v)).toEqual([
      'id',
      'status',
      'environment',
      'appName',
      'images',
      'counts',
      'creditsCharged',
      'creditsRefunded',
      'stores',
    ]);
  });
  it('quoteView flattens size', () => {
    expect(quoteView(quote() as never).breakdown[0]).toEqual({
      store: 'app_store',
      device: 'app_store_1290x2796',
      width: 1290,
      height: 2796,
      orientation: 'portrait',
      images: 2,
      defaulted: false,
    });
  });
  it('deviceView fills deprecated and replacedBy', () => {
    expect(deviceView(DEVICES.data[0] as never)).toMatchObject({
      deprecated: false,
      replacedBy: null,
    });
    expect(deviceView(DEVICES.data[3] as never)).toMatchObject({
      deprecated: true,
      replacedBy: 'google_play_1080x2160',
    });
  });
});
