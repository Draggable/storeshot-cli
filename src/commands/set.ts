import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CreateScreenshotSetRequest, ScreenshotSet } from '@draggable/storeshot-sdk';
import { bool, int, list, str } from '../args.js';
import { readCaptions } from '../captions.js';
import { keyed, type Ctx } from '../context.js';
import { planStores } from '../devicesPlan.js';
import { CliError } from '../errors.js';
import { readImageFile, type ImageFile } from '../shared/mcp.js';
import { guardSpend } from '../spend.js';
import { quoteView, setView, type Waited } from '../views.js';
import { waitForSet } from '../wait.js';
import { pullLines, saveSet } from './pull.js';
import {
  DEFAULT_TIMEOUT_S,
  TEST_NOTE,
  checkFastlaneOut,
  checkWaitFlags,
  compact,
  imageOptions,
  parseLayout,
  readLogo,
  upload,
} from './shared.js';
import type { CommandResult } from './types.js';

const IMAGE_EXT = /\.(png|jpe?g|webp|heic|heif)$/i;

export async function set(ctx: Ctx): Promise<CommandResult> {
  const p = ctx.args;
  const dir = path.resolve(ctx.cwd, p.positionals[0]);
  const realDir = await realpath(dir).catch(() => {
    throw new CliError('USAGE', `${dir} does not exist.`);
  });
  if (!(await stat(realDir)).isDirectory()) throw new CliError('USAGE', `${dir} is not a folder.`);
  checkWaitFlags(p);
  const outArg = str(p, 'out');
  if (str(p, 'layout') !== undefined && outArg === undefined)
    throw new CliError('USAGE', '--layout needs --out.');
  if (bool(p, 'dry-run') && outArg !== undefined)
    throw new CliError('USAGE', '--dry-run creates nothing to save: drop --out.');
  const layout = parseLayout(str(p, 'layout'));
  if (outArg !== undefined && layout === 'fastlane')
    checkFastlaneOut(path.resolve(ctx.cwd, outArg));
  const captionsArg = str(p, 'captions');
  const captions = await readCaptions(
    captionsArg ? path.resolve(ctx.cwd, captionsArg) : path.join(realDir, 'captions.json'),
  );
  const opts = imageOptions(p, {
    appName: captions.app?.name,
    appDescription: captions.app?.description,
  });
  // Spec §13.1: only the listed files are read, as plain names below the folder's real path.
  const screens: ImageFile[] = [];
  for (const s of captions.screens) screens.push(await readImageFile(s.file, { root: realDir }));
  const listed = new Set(captions.screens.map((s) => s.file));
  const unlisted = (await readdir(realDir)).filter((n) => IMAGE_EXT.test(n) && !listed.has(n));
  if (unlisted.length) ctx.out.notice(`Not in captions.json (skipped): ${unlisted.join(', ')}`);
  const logo = await readLogo(ctx);
  const client = await keyed(ctx);
  const catalogue = (await client.devices.list({}, { signal: ctx.signal })).data;
  const featureGraphic = bool(p, 'feature-graphic') ? true : captions.featureGraphic || undefined;
  const plan = planStores(
    { stores: list(p, 'store'), devices: list(p, 'devices'), featureGraphic },
    catalogue,
  );
  plan.warnings.forEach((w) => ctx.out.warn(w));
  const uploadIds: string[] = [];
  for (const f of screens) uploadIds.push(await upload(ctx, client, f));
  const logoId = logo ? await upload(ctx, client, logo) : undefined;
  const body = compact({
    app: opts.app,
    screens: captions.screens.map((s, i) => ({
      input: { uploadId: uploadIds[i] },
      caption: s.caption,
    })),
    stores: plan.stores,
    orientation: opts.orientation,
    palette: opts.palette,
    logo: logoId ? { uploadId: logoId } : undefined,
    projectId: opts.projectId,
  }) as CreateScreenshotSetRequest;
  const dryRun = bool(p, 'dry-run');
  const quote =
    dryRun || ctx.keyEnvironment === 'live'
      ? quoteView(await client.screenshotSets.quote(body, { signal: ctx.signal }))
      : null;
  const quoteData = { mode: 'quote' as const, quote, set: null, waited: null, download: null };
  if (dryRun && quote) {
    return {
      data: quoteData,
      human: [
        `${quote.images} images, ${quote.credits} credits (${quote.environment} key; ${quote.availableCredits} available). Nothing was created.`,
      ],
    };
  }
  if (quote)
    await guardSpend(ctx, {
      credits: quote.credits,
      available: quote.availableCredits,
      sufficient: quote.sufficient,
      data: quoteData,
    });
  const created = await client.screenshotSets.create(body, {
    idempotencyKey: str(p, 'idempotency-key'),
    signal: ctx.signal,
  });
  ctx.job = { kind: 'screenshot_set', id: created.id };
  ctx.out.notice(`Screenshot set ${created.id}: ${created.images} images.`);
  let current: ScreenshotSet = created;
  let waited: Waited | null = null;
  if (!bool(p, 'no-wait')) {
    const r = await waitForSet(client, created, {
      timeoutMs: (int(p, 'timeout') ?? DEFAULT_TIMEOUT_S) * 1000,
      signal: ctx.signal,
      out: ctx.out,
      now: ctx.now,
      pollMs: ctx.pollMs,
    });
    current = r.set;
    waited = r.waited;
  }
  const download =
    outArg && waited && !waited.timedOut && current.counts.succeeded > 0
      ? await saveSet(ctx, client, current.id, outArg, layout)
      : null;
  const data = { mode: 'set' as const, quote, set: setView(current), waited, download };
  const human = [
    `Screenshot set ${current.id}: ${current.status} (${current.counts.succeeded}/${current.images} succeeded).`,
    ...(download ? pullLines(download) : []),
    current.environment === 'test'
      ? TEST_NOTE
      : `${current.creditsCharged} live credit(s) charged.`,
  ];
  if (waited?.timedOut)
    throw new CliError('WAIT_TIMEOUT', `Still ${current.status} after ${waited.seconds} s.`, {
      data,
      human,
      details: { id: current.id },
    });
  if (waited && current.status !== 'succeeded') {
    throw new CliError('PARTIAL_FAILURE', `Screenshot set ${current.id} ${current.status}.`, {
      data,
      human,
      details: { id: current.id },
    });
  }
  if (!waited) human.push(`Follow with: storeshot status ${current.id} --wait`);
  return { data, human };
}
