import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { keyed } from '../src/context.js';
import { guardSpend } from '../src/spend.js';
import { testCtx } from './helpers/ctx.js';
import { tmpDir } from './helpers/tmp.js';

const home = tmpDir('spend');
afterAll(() => rmSync(home, { recursive: true, force: true }));
const LIVE = { STORESHOT_API_KEY: 'ss_live_' + 'p'.repeat(32) };
const TEST = { STORESHOT_API_KEY: 'ss_test_' + 'p'.repeat(32) };
const check = { credits: 4, available: 10, sufficient: true };
const run = async (
  argv: string[],
  env: Record<string, string>,
  o: { tty?: boolean; answer?: string | null } = {},
  c = check,
) => {
  const t = testCtx(argv, { home, env, ...o });
  await keyed(t.ctx);
  try {
    await guardSpend(t.ctx, c);
    return 'ok';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('guardSpend (spec §10)', () => {
  it('test keys never ask', async () => {
    expect(await run(['set', 'd'], TEST)).toBe('ok');
  });
  it('live + --yes proceeds', async () => {
    expect(await run(['set', 'd', '--yes'], LIVE)).toBe('ok');
  });
  it('live, not a TTY, no --yes → CONFIRMATION_REQUIRED', async () => {
    expect(await run(['set', 'd'], LIVE)).toBe('CONFIRMATION_REQUIRED');
  });
  it('live, --json on a TTY → CONFIRMATION_REQUIRED (no prompt)', async () => {
    expect(await run(['set', 'd', '--json'], LIVE, { tty: true, answer: 'y' })).toBe(
      'CONFIRMATION_REQUIRED',
    );
  });
  it('live TTY: y and yes proceed; anything else or EOF declines', async () => {
    expect(await run(['set', 'd'], LIVE, { tty: true, answer: 'y' })).toBe('ok');
    expect(await run(['set', 'd'], LIVE, { tty: true, answer: 'YES' })).toBe('ok');
    expect(await run(['set', 'd'], LIVE, { tty: true, answer: 'n' })).toBe('SPEND_DECLINED');
    expect(await run(['set', 'd'], LIVE, { tty: true, answer: null })).toBe('SPEND_DECLINED');
  });
  it('--max-credits caps before anything else, even with --yes; 0 = must be free', async () => {
    expect(await run(['set', 'd', '--yes', '--max-credits', '3'], LIVE)).toBe(
      'SPEND_LIMIT_EXCEEDED',
    );
    expect(await run(['set', 'd', '--yes', '--max-credits', '0'], LIVE)).toBe(
      'SPEND_LIMIT_EXCEEDED',
    );
    expect(await run(['set', 'd', '--yes', '--max-credits', '4'], LIVE)).toBe('ok');
    expect(await run(['set', 'd', '--max-credits', '0'], TEST)).toBe('ok');
  });
  it('not enough credits → INSUFFICIENT_CREDITS before confirmation', async () => {
    expect(await run(['set', 'd'], LIVE, {}, { credits: 4, available: 1, sufficient: false })).toBe(
      'INSUFFICIENT_CREDITS',
    );
  });
});
