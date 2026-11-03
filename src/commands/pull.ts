import path from 'node:path';
import type { Generation, ScreenshotSet, Storeshot } from '@draggable/storeshot-sdk';
import { str } from '../args.js';
import { keyed, type Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { isLoopbackUrl, saveGenerationResult, saveSetArchive } from '../shared/mcp.js';
import { isFinalGeneration, isFinalSet, pullView } from '../views.js';
import { fetchJob } from './jobs.js';
import { checkFastlaneOut, checkId, openWriter, parseKind, parseLayout } from './shared.js';
import type { CommandResult } from './types.js';

const FASTLANE_TAIL =
  'Run `fastlane deliver` / `fastlane supply` from that folder (supply replaces the screenshots of the folders it uploads).';

/** Saves a final set through the shared archive code; rolls back everything it wrote on error. */
export async function saveSet(
  ctx: Ctx,
  client: Storeshot,
  id: string,
  outArg: string,
  layout: 'store' | 'fastlane',
) {
  const writer = await openWriter(ctx, outArg);
  try {
    const saved = await saveSetArchive(client, id, writer, { layout, signal: ctx.signal });
    return pullView(saved, { kind: 'screenshot_set', id, folder: writer.folder, layout });
  } catch (error) {
    await writer.rollback();
    throw error;
  }
}

export const pullLines = (v: ReturnType<typeof pullView>) => [
  ...v.files.map((f) => f.path),
  `Saved ${v.files.length} file(s) under ${v.folder}${v.complete ? '' : ` (${v.missing.length} image(s) missing)`}.`,
  ...(v.layout === 'fastlane' && v.files.length ? [FASTLANE_TAIL] : []),
];

export async function pull(ctx: Ctx): Promise<CommandResult> {
  const p = ctx.args;
  const id = checkId(p.positionals[0]);
  const kind = parseKind(str(p, 'kind'));
  const layout = parseLayout(str(p, 'layout'));
  const outArg = str(p, 'out') ?? (layout === 'fastlane' ? '.' : `storeshot-${id}`);
  if (layout === 'fastlane') checkFastlaneOut(path.resolve(ctx.cwd, outArg));
  const client = await keyed(ctx);
  const job = await fetchJob(client, id, kind, ctx.signal);
  ctx.job = { kind: job.kind, id };
  const status = job.value.status;
  const final = job.kind === 'generation' ? isFinalGeneration(status) : isFinalSet(status);
  if (!final)
    throw new CliError(
      'NOT_READY',
      `${job.kind === 'generation' ? 'Generation' : 'Screenshot set'} ${id} is still ${status}.`,
      { details: { id } },
    );
  if (job.kind === 'generation') {
    const g = job.value as Generation;
    if (g.status !== 'succeeded')
      throw new CliError(
        'PARTIAL_FAILURE',
        `Generation ${id} ${g.status}: there is no image to save.`,
        { details: { id } },
      );
    const writer = await openWriter(ctx, str(p, 'out') ?? '.');
    try {
      const saved = await saveGenerationResult(g, writer, {
        allowLoopbackHttp: isLoopbackUrl(ctx.config.baseUrl),
        signal: ctx.signal,
      });
      const data = pullView(saved, {
        kind: 'generation',
        id,
        folder: writer.folder,
        layout: 'store',
      });
      return { data, human: pullLines(data) };
    } catch (error) {
      await writer.rollback();
      throw error;
    }
  }
  const s = job.value as ScreenshotSet;
  if (s.counts.succeeded === 0)
    throw new CliError('PARTIAL_FAILURE', `Screenshot set ${id} ${s.status}: no image succeeded.`, {
      details: { id },
    });
  const data = await saveSet(ctx, client, id, outArg, layout);
  const human = pullLines(data);
  if (!data.complete) {
    throw new CliError(
      'PARTIAL_FAILURE',
      `${data.missing.length} image(s) of set ${id} did not succeed; the others were saved.`,
      { data, human, details: { id } },
    );
  }
  return { data, human };
}
