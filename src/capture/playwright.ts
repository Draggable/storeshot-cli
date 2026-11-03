// Spec §9.1: the Playwright of the user's project, found the way Node would from the current
// folder and loaded through a computed file URL. Never bundled, never declared (D4 deviation),
// so esbuild sees no bare "playwright" import. Only the members runWeb uses are typed.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError } from '../errors.js';

export interface PwResponse {
  status(): number;
}
export interface PwPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<PwResponse | null>;
  waitForSelector(selector: string, opts: { state: 'visible'; timeout: number }): Promise<unknown>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts: Record<string, unknown>): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface PwContext {
  newPage(): Promise<PwPage>;
}
export interface PwBrowser {
  newContext(opts: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}
export interface PwChromium {
  launch(opts: Record<string, unknown>): Promise<PwBrowser>;
}
export interface Playwright {
  name: string;
  version: string;
  /** The resolved package folder (data.tool.path). */
  path: string;
  chromium: PwChromium;
}

const CANDIDATES = ['playwright', '@playwright/test', 'playwright-core'];
export const MIN_VERSION = '1.40.0';
export const INSTALL_HINT =
  'capture web runs the Playwright of your project. Install it there: npm install -D playwright, then npx playwright install chromium.';

export function atLeast(version: string, min: string): boolean {
  const a = version.split(/[.-]/).slice(0, 3).map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  return true;
}

function packageRoot(entry: string, name: string): string | null {
  let dir = path.dirname(entry);
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        if (JSON.parse(readFileSync(file, 'utf8')).name === name) return dir;
      } catch {
        // not a package.json we can read: keep walking
      }
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export interface ResolveDeps {
  resolve(cwd: string, name: string): string | null;
  load(file: string): Promise<Record<string, unknown>>;
}
const nodeDeps: ResolveDeps = {
  resolve(cwd, name) {
    try {
      return createRequire(path.join(cwd, 'package.json')).resolve(name);
    } catch {
      return null;
    }
  },
  load: (file) => import(pathToFileURL(file).href) as Promise<Record<string, unknown>>,
};
let deps: ResolveDeps = nodeDeps;
/** Tests only (the repo's set*ForTests convention). null restores Node's lookup. */
export function setPlaywrightDepsForTests(value: ResolveDeps | null): void {
  deps = value ?? nodeDeps;
}

export async function resolvePlaywright(cwd: string): Promise<Playwright> {
  for (const name of CANDIDATES) {
    const entry = deps.resolve(cwd, name);
    if (!entry) continue;
    const root = packageRoot(entry, name);
    const version = root
      ? String(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version)
      : '0.0.0';
    if (!atLeast(version, MIN_VERSION)) {
      throw new CliError(
        'CAPTURE_TOOL_MISSING',
        `${name} ${version} is too old: capture web needs Playwright ${MIN_VERSION} or later.`,
        { hint: INSTALL_HINT },
      );
    }
    const mod = await deps.load(entry);
    const chromium = (mod.chromium ??
      (mod.default as { chromium?: unknown } | undefined)?.chromium) as PwChromium | undefined;
    if (chromium) return { name, version, path: root ?? path.dirname(entry), chromium };
  }
  throw new CliError('CAPTURE_TOOL_MISSING', `Playwright was not found from ${cwd}.`, {
    hint: INSTALL_HINT,
  });
}
