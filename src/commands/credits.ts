import { StoreshotError } from '@draggable/storeshot-sdk';
import { keyed, type Ctx } from '../context.js';
import { CliError } from '../errors.js';
import type { CommandResult } from './types.js';

export async function credits(ctx: Ctx): Promise<CommandResult> {
  const client = await keyed(ctx);
  try {
    const c = await client.credits.get({ signal: ctx.signal });
    const b = c.balances;
    return {
      data: {
        environment: ctx.keyEnvironment,
        total: c.total,
        balances: { starter: b.starter, subscription: b.subscription, purchased: b.purchased },
      },
      human: [
        `${c.total} credits (${ctx.keyEnvironment}): starter ${b.starter}, subscription ${b.subscription}, purchased ${b.purchased}.`,
      ],
    };
  } catch (error) {
    if (error instanceof StoreshotError && error.code === 'FORBIDDEN') {
      throw new CliError('FORBIDDEN', error.message, {
        hint: 'This key lacks usage:read: run storeshot login again or use a key with that scope.',
      });
    }
    throw error;
  }
}
