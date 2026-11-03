import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  StoreshotError,
  type CreateGenerationRequest,
  type Generation,
  type Storeshot,
} from '@draggable/storeshot-sdk';
import { bool, int, str } from '../args.js';
import { readCaptions } from '../captions.js';
import { keyed, type Ctx } from '../context.js';
import { CliError } from '../errors.js';
import {
  isLoopbackUrl,
  readImageFile,
  saveGenerationResult,
  type ImageFile,
  type SavedFile,
} from '../shared/mcp.js';
import { guardSpend } from '../spend.js';
import { downloadView, generationView, isFinalGeneration, type Waited } from '../views.js';
import { waitForGenerations } from '../wait.js';
import { isStore } from './devices.js';
import {
  DEFAULT_TIMEOUT_S,
  TEST_NOTE,
  checkWaitFlags,
  compact,
  extOf,
  imageOptions,
  nn,
  openWriter,
  outputName,
  parseSize,
  readLogo,
  spendFor,
  upload,
} from './shared.js';
import type { CommandResult } from './types.js';

interface Made {
  file: ImageFile;
  uploadId: string;
  generation: Generation;
}

async function checkDevice(ctx: Ctx, client: Storeshot, store: string, device: string) {
  const { data } = await client.devices.list({}, { signal: ctx.signal });
  const d = data.find((x) => x.id === device);
  if (!d || d.store !== store) {
    throw new CliError('USAGE', `${device} is not a ${store} device.`, {
      hint: `storeshot devices --store ${store} lists them.`,
    });
  }
  if (d.deprecated) ctx.out.warn(`${device} is deprecated: use ${d.replacedBy}.`);
}

/** Spec §8.1 step 5: on CONCURRENCY_LIMITED wait for the earliest unfinished image, same key. */
async function createWithRoom(
  ctx: Ctx,
  client: Storeshot,
  body: CreateGenerationRequest,
  key: string,
  made: Made[],
  deadline: number,
) {
  for (;;) {
    try {
      return await client.generations.create(body, { idempotencyKey: key, signal: ctx.signal });
    } catch (error) {
      const busy = error instanceof StoreshotError && error.code === 'CONCURRENCY_LIMITED';
      const earlier = made.find((m) => !isFinalGeneration(m.generation.status));
      if (!busy || !earlier || ctx.now() >= deadline) throw error;
      ctx.out.notice(`Too many images in flight: waiting for ${earlier.generation.id} first.`);
      earlier.generation = await client.waitForGeneration(earlier.generation, {
        timeoutMs: deadline - ctx.now(),
        signal: ctx.signal,
      });
    }
  }
}

export async function generate(ctx: Ctx): Promise<CommandResult> {
  const p = ctx.args;
  const store = str(p, 'store');
  if (!isStore(store)) throw new CliError('USAGE', '--store app_store|google_play is required.');
  const device = str(p, 'device');
  const size = parseSize(str(p, 'size'));
  if (Boolean(device) === Boolean(size))
    throw new CliError('USAGE', 'Pass exactly one of --device and --size.');
  if (str(p, 'caption') !== undefined && str(p, 'captions') !== undefined)
    throw new CliError('USAGE', 'Pass --caption or --captions, not both.');
  checkWaitFlags(p);
  const opts = imageOptions(p);
  const captionsArg = str(p, 'captions');
  const captions = captionsArg ? await readCaptions(path.resolve(ctx.cwd, captionsArg)) : null;
  const files: ImageFile[] = [];
  for (const input of p.positionals)
    files.push(await readImageFile(path.resolve(ctx.cwd, input), { root: null }));
  const logo = await readLogo(ctx);
  const client = await keyed(ctx);
  if (device) await checkDevice(ctx, client, store, device);
  await guardSpend(ctx, await spendFor(ctx, client, files.length));
  const deadline = ctx.now() + (int(p, 'timeout') ?? DEFAULT_TIMEOUT_S) * 1000;
  const logoId = logo ? await upload(ctx, client, logo) : undefined;
  const baseKey = str(p, 'idempotency-key');
  const made: Made[] = [];
  for (const [i, file] of files.entries()) {
    const uploadId = await upload(ctx, client, file);
    const caption =
      str(p, 'caption') ?? captions?.screens.find((s) => s.file === file.filename)?.caption;
    const body = compact({
      inputs: [{ uploadId }],
      store,
      device,
      size,
      app: opts.app,
      caption,
      orientation: opts.orientation,
      palette: opts.palette,
      logo: logoId ? { uploadId: logoId } : undefined,
      projectId: opts.projectId,
    }) as CreateGenerationRequest;
    const key = baseKey ? `${baseKey}-${nn(i + 1)}` : `storeshot-cli-${randomUUID()}`;
    const generation = await createWithRoom(ctx, client, body, key, made, deadline);
    made.push({ file, uploadId, generation });
    ctx.job = { kind: 'generation', id: generation.id };
    ctx.out.notice(`Generation ${generation.id} created for ${file.filename}.`);
  }
  let waited: Waited | null = null;
  if (!bool(p, 'no-wait')) {
    const r = await waitForGenerations(
      client,
      made.map((m) => m.generation),
      {
        timeoutMs: Math.max(0, deadline - ctx.now()),
        signal: ctx.signal,
        out: ctx.out,
        now: ctx.now,
      },
    );
    r.generations.forEach((g, i) => (made[i].generation = g));
    waited = r.waited;
  }
  const outArg = str(p, 'out');
  let download: ReturnType<typeof downloadView> | null = null;
  if (outArg && waited && !waited.timedOut) {
    const ok = made
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.generation.status === 'succeeded');
    const writer = await openWriter(ctx, outArg);
    const saved: SavedFile[] = [];
    try {
      const names = ok.map(({ m, i }) => outputName(i + 1, m.file.filename, m.generation.device));
      await writer.preflight(
        ok.map(({ m }, k) => `${names[k]}.${extOf(m.generation.result!.image.contentType)}`),
      );
      for (const [k, { m }] of ok.entries()) {
        const r = await saveGenerationResult(m.generation, writer, {
          name: names[k],
          allowLoopbackHttp: isLoopbackUrl(ctx.config.baseUrl),
          signal: ctx.signal,
        });
        saved.push(...r.files);
      }
    } catch (error) {
      await writer.rollback();
      throw error;
    }
    download = downloadView(writer.folder, saved);
  }
  const gens = made.map((m) => m.generation);
  const charged = gens.reduce((n, g) => n + g.creditsCharged, 0);
  const data = {
    environment: ctx.keyEnvironment,
    creditsCharged: charged,
    creditsRefunded: gens.reduce((n, g) => n + g.creditsRefunded, 0),
    waited,
    generations: made.map((m) =>
      generationView(m.generation, { input: m.file.filename, uploadId: m.uploadId }),
    ),
    download,
  };
  const human = [
    ...made.map(
      (m) =>
        `${m.generation.status.padEnd(9)} ${m.generation.id}  ${m.file.filename} → ${m.generation.device}`,
    ),
    ...(download ? download.files.map((f) => f.path) : []),
    ctx.keyEnvironment === 'test' ? TEST_NOTE : `${charged} live credit(s) charged.`,
  ];
  const unfinished = gens.find((g) => !isFinalGeneration(g.status));
  if (waited?.timedOut && unfinished) {
    throw new CliError('WAIT_TIMEOUT', `Still running after ${waited.seconds} s.`, {
      data,
      human,
      details: { id: unfinished.id },
    });
  }
  const failed = gens.filter((g) => isFinalGeneration(g.status) && g.status !== 'succeeded');
  if (waited && failed.length) {
    throw new CliError(
      'PARTIAL_FAILURE',
      `${failed.length} of ${gens.length} image(s) did not succeed.`,
      { data, human, details: { id: failed[0].id } },
    );
  }
  if (!waited) human.push(`Follow with: storeshot status ${gens[0].id} --wait`);
  return { data, human };
}
