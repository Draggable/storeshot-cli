import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { readImageFile } from '../shared/mcp.js';
import { XCODE_HINT, requireTool, runnerFor } from './runner.js';
import { SIMCTL_MISSING, parseBooted, pickSimulator, simctl, type Simulator } from './simctl.js';
import { interruptNote, iosDriver, newReport, withStatusBar } from './statusBar.js';
import { tail, type Runner } from './tools.js';
import type { DeviceCaptureOptions, PlatformResult } from './types.js';

const LIST_MS = 15_000;
const failed = (label: string, r: { code: number | null; stderr: string }) =>
  new CliError(
    'CAPTURE_FAILED',
    `${label} failed (exit ${r.code})${r.stderr ? `: ${tail(r.stderr)}` : ''}.`,
  );

/** Spec §7 step 2: the booted iPhone/iPad simulator to use (also for --reset-status-bar). */
export async function bootedSimulator(ctx: Ctx, run: Runner, udid?: string): Promise<Simulator> {
  const label = 'xcrun simctl list';
  const r = await run(simctl.listBooted(), { timeoutMs: LIST_MS, signal: ctx.signal, label });
  if (r.code !== 0) {
    if (SIMCTL_MISSING.test(r.stderr)) {
      throw new CliError(
        'CAPTURE_TOOL_MISSING',
        'xcrun has no simctl (only the command line tools are installed).',
        {
          hint: XCODE_HINT,
        },
      );
    }
    throw failed(label, r);
  }
  return pickSimulator(parseBooted(r.stdout.toString('utf8')), udid);
}

export async function runIos(
  ctx: Ctx,
  opts: DeviceCaptureOptions & { udid?: string },
): Promise<PlatformResult> {
  const tool = requireTool(ctx, 'xcrun');
  const run = runnerFor(ctx, tool);
  const sim = await bootedSimulator(ctx, run, opts.udid);
  const driver = opts.cleanStatusBar ? iosDriver(run, sim.udid) : null;
  const report = newReport(driver);
  ctx.out.progress(`Capturing ${sim.name}${sim.os ? ` (${sim.os})` : ''}…`);
  try {
    const image = await withStatusBar(
      driver,
      report,
      { settleMs: opts.settleMs, signal: ctx.signal, notice: (m) => ctx.out.notice(m) },
      async () => {
        // Spec §5.4: a private 0700 folder inside the real output folder, removed in finally.
        const tmp = await mkdtemp(path.join(opts.folder, '.storeshot-capture-'));
        try {
          const file = path.join(tmp, 'shot.png');
          const label = 'xcrun simctl io screenshot';
          const r = await run(simctl.screenshot(sim.udid, file), {
            timeoutMs: opts.timeoutMs,
            signal: ctx.signal,
            label,
          });
          if (r.code !== 0) throw failed(label, r);
          const read = await readImageFile(file, { root: tmp }).catch((e: { code?: string }) => {
            if (e?.code === 'FILE_TOO_LARGE') throw e;
            throw new CliError('CAPTURE_FAILED', `${label} wrote no image file.`);
          });
          return read.data;
        } finally {
          await rm(tmp, { recursive: true, force: true });
        }
      },
    );
    return {
      tool: { name: 'xcrun', path: tool.path, version: null },
      target: { kind: 'simulator', id: sim.udid, name: sim.name, os: sim.os },
      images: [image],
      statusBar: report,
      manual: driver?.manual ?? null,
    };
  } finally {
    ctx.interrupt = { note: interruptNote(report, driver) };
  }
}
