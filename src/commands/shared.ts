import path from 'node:path';
import { StoreshotError, type Storeshot } from '@draggable/storeshot-sdk';
import { bool, str, type Parsed } from '../args.js';
import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { readImageFile, TreeWriter, type ImageFile } from '../shared/mcp.js';
import type { SpendCheck } from '../spend.js';
import type { Job } from './jobs.js';

export const DEFAULT_TIMEOUT_S = 600;
/** The MCP server's wording (credits.ts TEST_KEY_NOTE). */
export const TEST_NOTE = 'Test key: sample images, no credits spent.';
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const usage = (message: string) => new CliError('USAGE', message);

/** Drops undefined keys (the API bodies are additionalProperties: false). */
export const compact = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const nn = (n: number) => String(n).padStart(2, '0');

export function checkId(value: string): string {
  if (!UUID.test(value)) throw usage(`"${value}" is not a Storeshot id (36 characters).`);
  return value;
}

export function parseKind(value: string | undefined): Job['kind'] | undefined {
  if (value === undefined) return undefined;
  if (value === 'set') return 'screenshot_set';
  if (value === 'generation') return 'generation';
  throw usage('--kind must be set or generation.');
}

export function parseLayout(value: string | undefined): 'store' | 'fastlane' {
  if (value === undefined || value === 'store') return 'store';
  if (value === 'fastlane') return 'fastlane';
  throw usage('--layout must be store or fastlane.');
}

export function parsePalette(
  value: string | undefined,
): { hex: string; name: string }[] | undefined {
  if (value === undefined) return undefined;
  const entries = value
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length < 1 || entries.length > 8) throw usage('--palette takes 1–8 colours.');
  return entries.map((e) => {
    const m = /^(#[0-9A-Fa-f]{6}):(.{1,40})$/.exec(e);
    if (!m) throw usage(`--palette entry "${e}" must be #RRGGBB:Name (name 1–40 characters).`);
    return { hex: m[1], name: m[2].trim() };
  });
}

export function parseSize(
  value: string | undefined,
): { width: number; height: number } | undefined {
  if (value === undefined) return undefined;
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(value);
  if (!m) throw usage('--size must be <width>x<height>, e.g. 1290x2796.');
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Spec §8.5: NN_<stem>_<device>; always passes the shared safeRelativeName rule. */
export function outputName(position: number, filename: string, device: string): string {
  const base = path.basename(filename).replace(/^\.+/, '');
  const stem = path
    .basename(base, path.extname(base))
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 60);
  return `${nn(position)}_${stem || 'image'}_${device}`;
}

/** Spec §8.4: the archive is rooted at fastlane/, so --out is the project root. */
export function checkFastlaneOut(resolved: string): void {
  const parts = resolved.split(path.sep).filter(Boolean);
  const last = parts.at(-1);
  if (last === 'fastlane' || (last === 'screenshots' && parts.at(-2) === 'fastlane')) {
    throw usage(
      `--out ${resolved} is inside fastlane/: pass the project root (the folder that contains fastlane/), e.g. --out .`,
    );
  }
}

export interface ImageOptions {
  app: { name: string; description?: string };
  orientation?: 'portrait' | 'landscape';
  palette?: { hex: string; name: string }[];
  projectId?: string;
}

export function imageOptions(
  p: Parsed,
  fallback: { appName?: string; appDescription?: string } = {},
): ImageOptions {
  const name = str(p, 'app-name') ?? fallback.appName;
  if (!name || name.length > 100)
    throw usage('--app-name (1–100 characters) is required (or app.name in captions.json).');
  const description = str(p, 'app-description') ?? fallback.appDescription;
  if (description !== undefined && description.length > 2000)
    throw usage('--app-description is at most 2000 characters.');
  const orientation = str(p, 'orientation');
  if (orientation !== undefined && orientation !== 'portrait' && orientation !== 'landscape') {
    throw usage('--orientation must be portrait or landscape.');
  }
  const project = str(p, 'project');
  return {
    app: compact({ name, description }),
    orientation: orientation as ImageOptions['orientation'],
    palette: parsePalette(str(p, 'palette')),
    projectId: project === undefined ? undefined : checkId(project),
  };
}

export function checkWaitFlags(p: Parsed): void {
  if (bool(p, 'no-wait') && str(p, 'out') !== undefined)
    throw usage('--out needs the wait: drop --no-wait.');
}

export async function readLogo(ctx: Ctx): Promise<ImageFile | null> {
  const logo = str(ctx.args, 'logo');
  return logo === undefined ? null : readImageFile(path.resolve(ctx.cwd, logo), { root: null });
}

export async function upload(ctx: Ctx, client: Storeshot, file: ImageFile): Promise<string> {
  ctx.out.notice(`Uploading ${file.filename} (${Math.ceil(file.bytes / 1024)} KB)…`);
  const up = await client.uploads.create(
    { file: file.data, filename: file.filename, contentType: file.contentType },
    { signal: ctx.signal },
  );
  return up.id;
}

/** The live balance for the spend guard; null when the key lacks usage:read. */
export async function spendFor(ctx: Ctx, client: Storeshot, credits: number): Promise<SpendCheck> {
  if (ctx.keyEnvironment !== 'live') return { credits: 0, available: null, sufficient: null };
  try {
    const { total } = await client.credits.get({ signal: ctx.signal });
    return { credits, available: total, sufficient: total >= credits };
  } catch (error) {
    if (error instanceof StoreshotError && error.code === 'FORBIDDEN')
      return { credits, available: null, sufficient: null };
    throw error;
  }
}

export async function openWriter(ctx: Ctx, outArg: string): Promise<TreeWriter> {
  return TreeWriter.open(path.resolve(ctx.cwd, outArg), {
    root: null,
    overwrite: bool(ctx.args, 'force'),
  });
}

export const extOf = (contentType: string) =>
  contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : 'png';
