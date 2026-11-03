import type { Generation, ScreenshotSet } from '@draggable/storeshot-sdk';
import { bool, int, str } from '../args.js';
import { keyed, type Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { generationView, isFinalGeneration, isFinalSet, setView, type Waited } from '../views.js';
import { waitForGenerations, waitForSet } from '../wait.js';
import { fetchJob, type Job } from './jobs.js';
import { DEFAULT_TIMEOUT_S, checkId, parseKind } from './shared.js';
import type { CommandResult } from './types.js';

export async function status(ctx: Ctx): Promise<CommandResult> {
  const p = ctx.args;
  const id = checkId(p.positionals[0]);
  const client = await keyed(ctx);
  let job: Job = await fetchJob(client, id, parseKind(str(p, 'kind')), ctx.signal);
  ctx.job = { kind: job.kind, id };
  let waited: Waited | null = null;
  if (bool(p, 'wait')) {
    const opts = {
      timeoutMs: (int(p, 'timeout') ?? DEFAULT_TIMEOUT_S) * 1000,
      signal: ctx.signal,
      out: ctx.out,
      now: ctx.now,
    };
    if (job.kind === 'generation') {
      const r = await waitForGenerations(client, [job.value], opts);
      job = { kind: 'generation', value: r.generations[0] };
      waited = r.waited;
    } else {
      const r = await waitForSet(client, job.value, { ...opts, pollMs: ctx.pollMs });
      job = { kind: 'screenshot_set', value: r.set };
      waited = r.waited;
    }
  }
  const v = job.value;
  const final = job.kind === 'generation' ? isFinalGeneration(v.status) : isFinalSet(v.status);
  const data = {
    kind: job.kind,
    id,
    status: v.status,
    final,
    environment: v.environment,
    waited,
    set: job.kind === 'screenshot_set' ? setView(v as ScreenshotSet) : null,
    generation:
      job.kind === 'generation'
        ? generationView(v as Generation, { input: null, uploadId: null })
        : null,
  };
  const counts =
    job.kind === 'screenshot_set'
      ? ` (${(v as ScreenshotSet).counts.succeeded}/${(v as ScreenshotSet).images} succeeded)`
      : '';
  const human = [
    `${job.kind === 'generation' ? 'Generation' : 'Screenshot set'} ${id}: ${v.status}${counts}.`,
  ];
  if (waited?.timedOut)
    throw new CliError('WAIT_TIMEOUT', `Still ${v.status} after ${waited.seconds} s.`, {
      data,
      human,
      details: { id },
    });
  if (final && v.status !== 'succeeded')
    throw new CliError('PARTIAL_FAILURE', `${human[0]}`, { data, human, details: { id } });
  return { data, human };
}
