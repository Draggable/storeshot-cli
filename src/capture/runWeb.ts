import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import type { Preset } from './catalogue.js';
import { INSTALL_HINT, resolvePlaywright, type PwBrowser, type PwContext } from './playwright.js';
import { newReport } from './statusBar.js';
import { childEnv } from './tools.js';
import type { PlatformResult } from './types.js';

export interface WebShot {
  file: string;
  url: string;
  waitFor?: string;
  delayMs: number;
}
export interface WebOptions {
  preset: Preset;
  shots: WebShot[];
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  colorScheme: 'light' | 'dark';
  locale: string;
  timeoutMs: number;
}
const firstLine = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .split('\n')[0]
    .slice(0, 300);

export async function runWeb(ctx: Ctx, opts: WebOptions): Promise<PlatformResult> {
  const pw = await resolvePlaywright(ctx.cwd);
  let browser: PwBrowser;
  try {
    // Spec §9.3: bin.ts owns the signals; Playwright's own handlers would race our cleanup.
    browser = await pw.chromium.launch({
      headless: true,
      env: childEnv(ctx.env),
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      timeout: opts.timeoutMs,
    });
  } catch (error) {
    const message = firstLine(error);
    if (
      /Executable doesn't exist|playwright install/i.test(
        String((error as Error)?.message ?? error),
      )
    ) {
      throw new CliError(
        'CAPTURE_TOOL_MISSING',
        `Chromium for ${pw.name} ${pw.version} is not installed.`,
        {
          hint: INSTALL_HINT,
        },
      );
    }
    throw new CliError('CAPTURE_FAILED', `Chromium did not start: ${message}`);
  }
  ctx.interrupt = { note: 'Nothing was written.' };
  const onAbort = () => void browser.close().catch(() => undefined);
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const context = await browser.newContext({
      viewport: opts.preset.viewport,
      deviceScaleFactor: opts.preset.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      colorScheme: opts.colorScheme,
      locale: opts.locale,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const images: Uint8Array[] = [];
    for (const [i, shot] of opts.shots.entries()) {
      ctx.out.progress(`Capturing ${shot.url} (${i + 1}/${opts.shots.length})…`);
      images.push(await capturePage(context, shot, opts));
    }
    return {
      tool: { name: 'playwright', path: pw.path, version: pw.version },
      target: { kind: 'browser', id: 'chromium', name: 'Chromium', os: null },
      images,
      statusBar: newReport(null),
      manual: null,
    };
  } catch (error) {
    if (ctx.signal.aborted || error instanceof CliError) throw error;
    throw new CliError('CAPTURE_FAILED', `Playwright: ${firstLine(error)}`);
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
    await browser.close().catch(() => undefined);
  }
}

async function capturePage(
  context: PwContext,
  shot: WebShot,
  opts: WebOptions,
): Promise<Uint8Array> {
  const page = await context.newPage();
  const step = <T>(what: string, p: Promise<T>): Promise<T> =>
    p.catch((e: unknown) => {
      throw new CliError('CAPTURE_FAILED', `${what} failed: ${firstLine(e)}`, {
        details: { url: shot.url },
      });
    });
  try {
    const response = await step(
      `Loading ${shot.url}`,
      page.goto(shot.url, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs }),
    );
    const status = response?.status() ?? 200;
    if (status >= 400) {
      throw new CliError('CAPTURE_FAILED', `${shot.url} answered HTTP ${status}.`, {
        details: { url: shot.url, status },
      });
    }
    if (shot.waitFor) {
      await step(
        `Waiting for ${shot.waitFor}`,
        page.waitForSelector(shot.waitFor, { state: 'visible', timeout: opts.timeoutMs }),
      );
    }
    // Spec §9.3: web fonts, then the first painted frame after layout.
    await step(
      'Waiting for fonts and the first frame',
      page.evaluate(() =>
        document.fonts.ready.then(
          () =>
            new Promise<null>((r) =>
              requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
            ),
        ),
      ),
    );
    if (shot.delayMs > 0) await page.waitForTimeout(shot.delayMs);
    const png = await step(
      'Screenshot',
      page.screenshot({
        type: 'png',
        fullPage: false,
        animations: 'disabled',
        caret: 'hide',
        scale: 'device',
        timeout: opts.timeoutMs,
      }),
    );
    return new Uint8Array(png);
  } finally {
    await page.close().catch(() => undefined);
  }
}
