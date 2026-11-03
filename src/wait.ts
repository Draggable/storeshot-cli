import {
  StoreshotError,
  type Generation,
  type ScreenshotSet,
  type Storeshot,
} from '@draggable/storeshot-sdk';
import type { Output } from './output.js';
import { isFinalGeneration, isFinalSet, type Waited } from './views.js';

/** Waits `ms`, rejecting with the signal's reason on abort (Ctrl-C). */
export function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface WaitOpts {
  timeoutMs: number;
  signal: AbortSignal;
  out: Output;
  now?: () => number;
}

const describeSet = (s: ScreenshotSet) => {
  const c = s.counts;
  const done = c.succeeded + c.failed + c.canceled;
  return `${s.status} ${done}/${s.images} (${c.succeeded} succeeded, ${c.failed} failed)`;
};

/**
 * Spec §9: polls GET /screenshot-sets/{id} (3 s) until final or the timeout; progress on stderr.
 * Own loop because the SDK waiter has no per-poll callback; final states pinned to the contract.
 */
export async function waitForSet(
  client: Storeshot,
  set: ScreenshotSet,
  opts: WaitOpts & { pollMs?: number },
): Promise<{ set: ScreenshotSet; waited: Waited }> {
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 3000;
  const started = now();
  let current = set;
  for (;;) {
    const seconds = Math.round((now() - started) / 1000);
    opts.out.progress(
      `Screenshot set ${current.id}: ${describeSet(current)} (${seconds} s)`,
      describeSet(current),
    );
    if (isFinalSet(current.status)) return { set: current, waited: { seconds, timedOut: false } };
    const remaining = opts.timeoutMs - (now() - started);
    if (remaining <= 0) return { set: current, waited: { seconds, timedOut: true } };
    await sleepFor(Math.min(pollMs, remaining), opts.signal);
    current = await client.screenshotSets.get(current.id, { signal: opts.signal });
  }
}

/** Spec §9: the SDK's long-polling waiter per generation, in order, under one deadline. */
export async function waitForGenerations(
  client: Storeshot,
  generations: Generation[],
  opts: WaitOpts,
): Promise<{ generations: Generation[]; waited: Waited }> {
  const now = opts.now ?? Date.now;
  const started = now();
  const result = [...generations];
  const done = () => result.filter((g) => isFinalGeneration(g.status)).length;
  const tick = () => {
    const seconds = Math.round((now() - started) / 1000);
    opts.out.progress(
      `Waiting for ${result.length} image(s): ${done()} done (${seconds} s)`,
      `${done()}`,
    );
  };
  tick();
  const ticker = setInterval(tick, 1000);
  ticker.unref?.();
  let timedOut = false;
  try {
    for (const [i, g] of result.entries()) {
      if (isFinalGeneration(g.status)) continue;
      if (timedOut) {
        result[i] = await client.generations.get(g.id, { signal: opts.signal });
        continue;
      }
      const remaining = opts.timeoutMs - (now() - started);
      try {
        if (remaining <= 0) throw new StoreshotError({ code: 'WAIT_TIMEOUT', message: 'deadline' });
        result[i] = await client.waitForGeneration(g, {
          timeoutMs: remaining,
          signal: opts.signal,
        });
      } catch (error) {
        if (!(error instanceof StoreshotError) || error.code !== 'WAIT_TIMEOUT') throw error;
        timedOut = true;
        result[i] = await client.generations.get(g.id, { signal: opts.signal });
      }
      tick();
    }
  } finally {
    clearInterval(ticker);
  }
  return {
    generations: result,
    waited: { seconds: Math.round((now() - started) / 1000), timedOut },
  };
}
