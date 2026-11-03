import { bool, str } from '../args.js';
import { keyed, type Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { deviceView } from '../views.js';
import type { CommandResult } from './types.js';

export const STORES = ['app_store', 'google_play'] as const;
export type Store = (typeof STORES)[number];
export const isStore = (v: string | undefined): v is Store =>
  v === 'app_store' || v === 'google_play';

export async function devices(ctx: Ctx): Promise<CommandResult> {
  const store = str(ctx.args, 'store');
  if (store !== undefined && !isStore(store))
    throw new CliError('USAGE', '--store must be app_store or google_play.');
  const client = await keyed(ctx);
  const list = await client.devices.list(store ? { store } : {}, { signal: ctx.signal });
  const shown = list.data
    .map(deviceView)
    .filter((d) => !d.deprecated || bool(ctx.args, 'include-deprecated'));
  return {
    data: { devices: shown },
    human: shown.map(
      (d) =>
        `${d.id.padEnd(26)} ${d.store.padEnd(12)} ${d.kind.padEnd(16)} ${`${d.width}x${d.height}`.padEnd(10)} ${d.label}${d.deprecated ? ` (deprecated: use ${d.replacedBy})` : ''}`,
    ),
  };
}
