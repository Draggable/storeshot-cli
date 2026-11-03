import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { GLOBAL_FLAGS, bool, int, list, str } from '../args.js';
import { readCaptions, type Captions } from '../captions.js';
import { captionsText, planCaptions, type CaptionsPlan } from '../capture/captionsFile.js';
import {
  DEFAULT_WEB_DEVICE,
  findScreenshotDevice,
  matchDevice,
  presetFor,
  presetMatches,
  type Device,
  type Orientation,
  type Preset,
} from '../capture/catalogue.js';
import {
  checkFormFlags,
  checkUrl,
  fileNameOf,
  parseForm,
  resolveRoute,
  type Form,
} from '../capture/forms.js';
import { loadCatalogue } from '../capture/loadCatalogue.js';
import { countNumbered, nn, slugOfRoute } from '../capture/naming.js';
import { readPagesFile, type PageSpec } from '../capture/pages.js';
import { checkCapture, type PngInfo } from '../capture/png.js';
import { resetStatusBar } from '../capture/reset.js';
import { runAndroid } from '../capture/runAndroid.js';
import { runIos } from '../capture/runIos.js';
import { runWeb, type WebOptions } from '../capture/runWeb.js';
import type { PlatformResult } from '../capture/types.js';
import { assertFree, openFolder, writeCapture } from '../capture/writeCapture.js';
import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import type { WrittenFile } from '../shared/mcp.js';
import type { CommandResult } from './types.js';

export const DEFAULT_OUT = 'screens';
const DEFAULT_TIMEOUT_S = 30;
const DEFAULT_SETTLE_MS = 1000;
const DEFAULT_DELAY_MS = 300;
const usage = (message: string) => new CliError('USAGE', message);

interface Shot {
  file: string;
  caption?: string;
  url?: string;
  waitFor?: string;
  delayMs: number;
}

/** Spec §4: plan (fail early) → catalogue → capture → check → write → result. */
export async function capture(ctx: Ctx): Promise<CommandResult> {
  const p = ctx.args;
  const form = parseForm(p);
  checkFormFlags(p, form, Object.keys(GLOBAL_FLAGS));
  const timeoutMs = (int(p, 'timeout') ?? DEFAULT_TIMEOUT_S) * 1000;
  if (bool(p, 'reset-status-bar')) return resetStatusBar(ctx, form);
  const force = bool(p, 'force');
  const outArg = str(p, 'out') ?? DEFAULT_OUT;
  const folder = await openFolder(path.resolve(ctx.cwd, outArg));
  const captionsOn = !bool(p, 'no-captions');
  const existing = captionsOn ? await existingCaptions(folder) : null;
  const base = existing ? existing.screens.length : countNumbered(await readdir(folder));
  const shots = form === 'web' ? await webShots(ctx, base) : [deviceShot(ctx, base)];
  const plan = captionsOn ? planCaptions(existing, shots, str(p, 'app-name')) : null;
  await assertFree(
    folder,
    shots.map((s) => s.file),
    force,
  );
  const catalogue = await loadCatalogue(ctx);
  const warn = (m: string) => ctx.out.warn(m);
  const deviceId = str(p, 'device') ?? (form === 'web' ? DEFAULT_WEB_DEVICE : undefined);
  const orientation = (str(p, 'orientation') ?? 'portrait') as Orientation;
  const preset = deviceId
    ? presetFor(
        findScreenshotDevice(catalogue.devices, deviceId, warn),
        orientation,
        catalogue.source,
        form === 'web',
        warn,
      )
    : null;
  const device = {
    folder,
    cleanStatusBar: bool(p, 'clean-status-bar'),
    settleMs: int(p, 'settle') ?? DEFAULT_SETTLE_MS,
    timeoutMs,
  };
  const result: PlatformResult =
    form === 'ios'
      ? await runIos(ctx, { ...device, udid: str(p, 'udid') })
      : form === 'android'
        ? await runAndroid(ctx, { ...device, serial: str(p, 'serial') })
        : await runWeb(ctx, {
            preset: preset!,
            shots: shots.map((s) => ({
              file: s.file,
              url: s.url!,
              waitFor: s.waitFor,
              delayMs: s.delayMs,
            })),
            waitUntil: (str(p, 'wait-until') ?? 'load') as WebOptions['waitUntil'],
            colorScheme: (str(p, 'color-scheme') ?? 'light') as WebOptions['colorScheme'],
            locale: str(p, 'locale') ?? 'en-US',
            timeoutMs,
          });
  const infos = result.images.map((image) => checkCapture(image, result.tool.name));
  const written = await writeCapture(
    folder,
    shots.map((s, i) => ({ name: s.file, data: result.images[i] })),
    plan ? captionsText(plan.doc) : null,
    force,
  );
  const data = view({
    form,
    folder,
    outArg,
    result,
    preset,
    shots,
    infos,
    written,
    plan,
    devices: catalogue.devices,
  });
  for (const file of plan?.placeholders ?? [])
    warn(`captions.json: placeholder caption for ${file}; edit it before storeshot set.`);
  for (const s of data.screens) {
    if (form !== 'web' && s.orientation === 'landscape')
      warn(`${s.file} is landscape: pass --orientation landscape to storeshot set.`);
    if (form !== 'web' && s.presetMatch === false && preset) {
      warn(
        `Captured ${s.width}x${s.height}; ${preset.device} is ${preset.width}x${preset.height}. Storeshot renders every store size from it; boot a simulator or emulator of that size if you need this exact size.`,
      );
    }
  }
  const human = humanLines(data, outArg, result);
  if (result.statusBar.restored === false) {
    throw new CliError(
      'STATUS_BAR_NOT_RESTORED',
      'The capture was saved, but the status bar was not restored.',
      {
        data,
        human,
        hint: `Run ${result.manual}, or storeshot capture ${form} --reset-status-bar.`,
      },
    );
  }
  return { data, human };
}

async function existingCaptions(folder: string): Promise<Captions | null> {
  const file = path.join(folder, 'captions.json');
  return existsSync(file) ? readCaptions(file) : null;
}

function deviceShot(ctx: Ctx, base: number): Shot {
  const name = str(ctx.args, 'name');
  return {
    file: name !== undefined ? fileNameOf(name) : `${nn(base + 1)}.png`,
    caption: str(ctx.args, 'caption'),
    delayMs: 0,
  };
}

async function webShots(ctx: Ctx, base: number): Promise<Shot[]> {
  const p = ctx.args;
  const url = checkUrl(p.positionals[1]);
  const pagesFile = str(p, 'pages');
  const routes = list(p, 'route');
  const pages: (PageSpec | null)[] = pagesFile
    ? await readPagesFile(path.resolve(ctx.cwd, pagesFile))
    : routes.length
      ? routes.map((route) => ({ path: route }))
      : [null];
  if (pages.length > 10) throw usage('capture web takes at most 10 pages per run.');
  const single = pages.length === 1;
  if (!single && (str(p, 'name') !== undefined || str(p, 'caption') !== undefined))
    throw usage('--name and --caption take one page: use --pages for several.');
  const shots = pages.map((page, i): Shot => {
    const named = page?.name ?? (single ? str(p, 'name') : undefined);
    const route = page ? page.path : `${url.pathname}${url.hash}`;
    return {
      file:
        named !== undefined ? fileNameOf(named) : `${nn(base + i + 1)}-${slugOfRoute(route)}.png`,
      caption: page?.caption ?? (single ? str(p, 'caption') : undefined),
      url: page ? resolveRoute(url, page.path) : url.href,
      waitFor: page?.waitFor ?? str(p, 'wait-for'),
      delayMs: page?.delayMs ?? int(p, 'delay') ?? DEFAULT_DELAY_MS,
    };
  });
  const dup = shots.find((s, i) => shots.findIndex((t) => t.file === s.file) !== i);
  if (dup) throw usage(`Two pages would both be saved as ${dup.file}.`);
  return shots;
}

function view(v: {
  form: Form;
  folder: string;
  outArg: string;
  result: PlatformResult;
  preset: Preset | null;
  shots: Shot[];
  infos: PngInfo[];
  written: WrittenFile[];
  plan: CaptionsPlan | null;
  devices: Device[];
}) {
  const store =
    v.form === 'ios' ? 'app_store' : v.form === 'android' ? 'google_play' : v.preset!.store;
  const rel = /\s/.test(v.outArg) ? JSON.stringify(v.outArg) : v.outArg;
  const appMissing = v.plan !== null && !v.plan.doc.app;
  return {
    mode: 'capture' as const,
    platform: v.form,
    folder: v.folder,
    tool: v.result.tool,
    target: v.result.target,
    preset: v.preset,
    screens: v.written.map((w, i) => {
      const { width, height } = v.infos[i];
      return {
        file: w.relativePath,
        path: w.path,
        bytes: w.bytes,
        sha256: w.sha256,
        width,
        height,
        orientation: (width > height ? 'landscape' : 'portrait') as Orientation,
        url: v.shots[i].url ?? null,
        matchedDevice: matchDevice(v.devices, width, height),
        presetMatch: v.preset ? presetMatches(v.preset, width, height) : null,
        caption: v.plan?.doc.screens.find((s) => s.file === w.relativePath)?.caption ?? null,
        placeholderCaption: v.plan?.placeholders.includes(w.relativePath) ?? false,
      };
    }),
    captions: v.plan
      ? {
          file: path.join(v.folder, 'captions.json'),
          screens: v.plan.doc.screens.length,
          written: true,
        }
      : null,
    statusBar: v.result.statusBar,
    next: `storeshot set ${rel} --store ${store}${appMissing ? ' --app-name "<app name>"' : ''}`,
  };
}

function humanLines(
  data: ReturnType<typeof view>,
  outArg: string,
  result: PlatformResult,
): string[] {
  const where = (url: string | null) =>
    url ?? [result.target.name, result.target.os].filter(Boolean).join(', ');
  const lines = data.screens.map(
    (s) => `Saved ${path.join(outArg, s.file)} (${s.width}×${s.height}, ${where(s.url)}).`,
  );
  if (data.captions) {
    const placeholders = data.screens.filter((s) => s.placeholderCaption).length;
    lines.push(
      `captions.json: ${data.captions.screens} screen(s)${placeholders ? ` (${placeholders} placeholder caption(s))` : ''}.`,
    );
  }
  if (data.statusBar.requested)
    lines.push(`Status bar ${data.statusBar.restored ? 'restored' : 'NOT restored'}.`);
  lines.push(`Next: ${data.next}`);
  return lines;
}
