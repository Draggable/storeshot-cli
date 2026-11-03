import { bool } from '../args.js';
import type { Ctx } from '../context.js';
import type { Environment } from '../config.js';
import type { CommandResult } from './types.js';

export const REVOKE_URL = 'https://console.storeshot.art/keys';

/** Spec §7.3: forgets local keys only (a device key cannot revoke itself, follow-up G1). */
export async function logout(ctx: Ctx): Promise<CommandResult> {
  const { config } = ctx;
  const environments: Environment[] = bool(ctx.args, 'all')
    ? ['test', 'live']
    : [config.environment];
  const removed: { environment: Environment; keyId: string }[] = [];
  for (const environment of environments) {
    const entry = ctx.store.read(config.baseUrl, environment);
    if (!entry) continue;
    ctx.store.remove(config.baseUrl, environment);
    removed.push({ environment, keyId: entry.keyId });
  }
  ctx.pending.clear();
  return {
    data: { removed, credentialsFile: ctx.store.file, revokeUrl: REVOKE_URL },
    human: removed.length
      ? [
          ...removed.map((r) => `Forgot the ${r.environment} key ${r.keyId}.`),
          `The key still exists: revoke it at ${REVOKE_URL}.`,
        ]
      : ['No stored key to forget.'],
  };
}
