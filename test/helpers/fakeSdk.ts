import { vi } from 'vitest';

/** The SDK surface the CLI uses, as vi.fn()s; tests set the answers they need. */
export function fakeSdk() {
  return {
    baseUrl: 'https://api.storeshot.art/v1',
    me: vi.fn(),
    credits: { get: vi.fn() },
    devices: { list: vi.fn() },
    uploads: { create: vi.fn() },
    generations: { create: vi.fn(), get: vi.fn() },
    screenshotSets: { create: vi.fn(), quote: vi.fn(), get: vi.fn(), archiveStream: vi.fn() },
    auth: { startDeviceAuthorization: vi.fn(), pollDeviceToken: vi.fn() },
    waitForGeneration: vi.fn(),
  };
}
export type FakeSdk = ReturnType<typeof fakeSdk>;
