import { bool, int } from './args.js';
import type { Ctx } from './context.js';
import { CliError } from './errors.js';

export interface SpendCheck {
  credits: number;
  /** null: unknown (the key lacks usage:read). */
  available: number | null;
  sufficient: boolean | null;
  /** The command's `data` to report when refused (e.g. the set quote). */
  data?: unknown;
}

/**
 * Spec §10, in order: test keys pass; --max-credits caps; not enough credits fails; --yes, or a
 * y/yes answer on a TTY (not --json), confirms; anything else is CONFIRMATION_REQUIRED.
 */
export async function guardSpend(ctx: Ctx, check: SpendCheck): Promise<void> {
  if (ctx.keyEnvironment !== 'live') return;
  const details = {
    quote: {
      environment: 'live',
      credits: check.credits,
      availableCredits: check.available,
      sufficient: check.sufficient,
    },
  };
  const balance = check.available === null ? 'unknown' : String(check.available);
  const max = int(ctx.args, 'max-credits');
  if (max !== undefined && check.credits > max) {
    throw new CliError(
      'SPEND_LIMIT_EXCEEDED',
      `This would spend ${check.credits} live credits; --max-credits is ${max}. Nothing was created.`,
      { details, data: check.data },
    );
  }
  if (check.sufficient === false) {
    throw new CliError(
      'INSUFFICIENT_CREDITS',
      `This needs ${check.credits} live credits; ${balance} available. Nothing was created.`,
      { details, data: check.data },
    );
  }
  if (bool(ctx.args, 'yes')) return;
  if (ctx.stdinIsTTY && ctx.out.stderrIsTTY && !ctx.out.opts.json) {
    ctx.out.clearProgress();
    const answer = await ctx.prompt(
      `This will spend ${check.credits} live credits (balance ${balance}). Continue? [y/N] `,
    );
    if (answer !== null && /^(y|yes)$/i.test(answer.trim())) return;
    throw new CliError('SPEND_DECLINED', 'Not confirmed. Nothing was created or charged.', {
      details,
      data: check.data,
    });
  }
  throw new CliError(
    'CONFIRMATION_REQUIRED',
    `This would spend ${check.credits} live credits (balance ${balance}). Nothing was created.`,
    { details, data: check.data },
  );
}
