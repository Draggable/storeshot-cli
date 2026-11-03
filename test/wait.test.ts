import { StoreshotTimeoutError } from '@draggable/storeshot-sdk';
import { describe, expect, it, vi } from 'vitest';
import { waitForGenerations, waitForSet } from '../src/wait.js';
import { Output } from '../src/output.js';
import { fakeSdk } from './helpers/fakeSdk.js';
import { counts, generation, set } from './helpers/fixtures.js';
import { captured } from './helpers/streams.js';

const out = () => {
  const c = captured();
  return { c, out: new Output(c.streams, { json: false, quiet: false, noColor: true, env: {} }) };
};

describe('waitForSet', () => {
  it('polls until final and prints a line per change of counts (non-TTY)', async () => {
    const sdk = fakeSdk();
    sdk.screenshotSets.get
      .mockResolvedValueOnce(set('running', { counts: counts({ running: 2, queued: 2 }) }))
      .mockResolvedValueOnce(set('running', { counts: counts({ running: 2, queued: 2 }) }))
      .mockResolvedValueOnce(set('succeeded'));
    const o = out();
    const r = await waitForSet(sdk as never, set('queued') as never, {
      timeoutMs: 60_000,
      pollMs: 1,
      signal: new AbortController().signal,
      out: o.out,
    });
    expect(r.set.status).toBe('succeeded');
    expect(r.waited.timedOut).toBe(false);
    expect(o.c.stderr().trim().split('\n')).toHaveLength(3);
  });
  it('a timeout returns the latest state with timedOut', async () => {
    const sdk = fakeSdk();
    sdk.screenshotSets.get.mockResolvedValue(set('running'));
    let t = 0;
    const r = await waitForSet(sdk as never, set('queued') as never, {
      timeoutMs: 10,
      pollMs: 1,
      signal: new AbortController().signal,
      out: out().out,
      now: () => (t += 3),
    });
    expect(r).toMatchObject({ set: { status: 'running' }, waited: { timedOut: true } });
  });
  it('an abort rejects', async () => {
    const sdk = fakeSdk();
    sdk.screenshotSets.get.mockResolvedValue(set('running'));
    const c = new AbortController();
    const p = waitForSet(sdk as never, set('queued') as never, {
      timeoutMs: 60_000,
      pollMs: 50,
      signal: c.signal,
      out: out().out,
    });
    c.abort(new Error('SIGINT'));
    await expect(p).rejects.toThrow();
  });
});

describe('waitForGenerations', () => {
  it('delegates to the SDK waiter, one generation after another', async () => {
    const sdk = fakeSdk();
    sdk.waitForGeneration.mockResolvedValue(generation('succeeded'));
    const r = await waitForGenerations(
      sdk as never,
      [generation('queued') as never, generation('queued') as never],
      { timeoutMs: 60_000, signal: new AbortController().signal, out: out().out },
    );
    expect(sdk.waitForGeneration).toHaveBeenCalledTimes(2);
    expect(r.generations.map((g) => g.status)).toEqual(['succeeded', 'succeeded']);
  });
  it('WAIT_TIMEOUT stops waiting and returns the latest states', async () => {
    const sdk = fakeSdk();
    sdk.waitForGeneration.mockRejectedValue(
      new StoreshotTimeoutError({ code: 'WAIT_TIMEOUT', message: 't' }),
    );
    sdk.generations.get.mockResolvedValue(generation('running'));
    const r = await waitForGenerations(
      sdk as never,
      [generation('queued') as never, generation('queued') as never],
      { timeoutMs: 1000, signal: new AbortController().signal, out: out().out },
    );
    expect(r.waited.timedOut).toBe(true);
    expect(sdk.waitForGeneration).toHaveBeenCalledTimes(1);
    expect(r.generations.map((g) => g.status)).toEqual(['running', 'running']);
  });
  it('already final generations are not waited for', async () => {
    const sdk = fakeSdk();
    await waitForGenerations(sdk as never, [generation('succeeded') as never], {
      timeoutMs: 1000,
      signal: new AbortController().signal,
      out: out().out,
    });
    expect(sdk.waitForGeneration).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
