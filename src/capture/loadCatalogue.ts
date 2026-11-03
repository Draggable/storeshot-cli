import { StoreshotError } from '@draggable/storeshot-sdk';
import { bool } from '../args.js';
import type { Ctx } from '../context.js';
import { BUNDLED_DEVICES, type CatalogueSource, type Device } from './catalogue.js';

/** Spec §6.1: the API when a key is already at hand (5 s, no retry), else the bundled list. */
export async function loadCatalogue(
  ctx: Ctx,
): Promise<{ devices: Device[]; source: CatalogueSource }> {
  const bundled = { devices: BUNDLED_DEVICES, source: 'bundled' as const };
  if (bool(ctx.args, 'offline')) return bundled;
  const key =
    ctx.config.explicitKey?.value ??
    ctx.store.read(ctx.config.baseUrl, ctx.config.environment)?.apiKey ??
    null;
  if (!key) return bundled;
  ctx.out.addSecret(key);
  try {
    const list = await ctx
      .createClient(key)
      .devices.list({}, { signal: ctx.signal, timeoutMs: 5000, maxRetries: 0 });
    return { devices: list.data, source: 'api' };
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    const code = error instanceof StoreshotError ? error.code : 'ERROR';
    ctx.out.warn(`Device list unavailable (${code}): using the list bundled with this CLI.`);
    return bundled;
  }
}
