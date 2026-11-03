import type { Ctx } from '../context.js';
import { keyed } from '../context.js';
import type { CommandResult } from './types.js';

export async function whoami(ctx: Ctx): Promise<CommandResult> {
  const client = await keyed(ctx);
  const me = await client.me({ signal: ctx.signal });
  const c = me.credential;
  const data = {
    user: { id: me.user.id, displayName: me.user.displayName, email: me.user.email ?? null },
    credential: {
      type: c.type,
      environment: c.environment,
      scopes: [...c.scopes],
      keyId: c.apiKey?.id ?? null,
      keyName: c.apiKey?.name ?? null,
      keyPrefix: c.apiKey?.prefix ?? null,
      expiresAt: c.apiKey?.expiresAt ?? null,
    },
    keySource: ctx.keySource!,
    baseUrl: ctx.config.baseUrl,
    credentialsFile: ctx.keySource === 'stored' ? ctx.store.file : null,
  };
  return {
    data,
    human: [
      `${me.user.displayName ?? me.user.id}${me.user.email ? ` <${me.user.email}>` : ''}`,
      `${c.environment} key ${data.credential.keyPrefix ?? ''}… (${data.credential.keyName ?? 'unnamed'}) from ${ctx.keySource}`,
      `Scopes: ${c.scopes.join(' ')}`,
    ],
  };
}
