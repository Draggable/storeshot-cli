import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { adb, parseDevices, pickDevice, type AdbDevice } from './adb.js';
import { SERIAL } from './forms.js';
import { requireTool, runnerFor } from './runner.js';
import { androidDriver, interruptNote, newReport, withStatusBar } from './statusBar.js';
import { tail, type Runner } from './tools.js';
import type { DeviceCaptureOptions, PlatformResult } from './types.js';

const LIST_MS = 15_000;
const SCREENCAP_CAP = 64 * 1024 * 1024;

/** Spec §8 step 2: --serial, else a valid ANDROID_SERIAL, else the only usable device. */
export async function connectedDevice(ctx: Ctx, run: Runner, serial?: string): Promise<AdbDevice> {
  let chosen = serial;
  const fromEnv = ctx.env.ANDROID_SERIAL;
  if (!chosen && fromEnv) {
    if (SERIAL.test(fromEnv)) chosen = fromEnv;
    else ctx.out.warn('Ignoring ANDROID_SERIAL: it is not a valid device serial.');
  }
  const label = 'adb devices';
  const r = await run(adb.devices(), { timeoutMs: LIST_MS, signal: ctx.signal, label });
  if (r.code !== 0)
    throw new CliError(
      'CAPTURE_FAILED',
      `${label} failed (exit ${r.code})${r.stderr ? `: ${tail(r.stderr)}` : ''}.`,
    );
  return pickDevice(parseDevices(r.stdout.toString('utf8')), chosen);
}

async function text(ctx: Ctx, run: Runner, args: string[], label: string): Promise<string | null> {
  const r = await run(args, { timeoutMs: LIST_MS, signal: ctx.signal, label }).catch((e) => {
    if (ctx.signal.aborted) throw e;
    return null;
  });
  const value = r?.code === 0 ? r.stdout.toString('utf8').trim() : '';
  return value || null;
}

export async function runAndroid(
  ctx: Ctx,
  opts: DeviceCaptureOptions & { serial?: string },
): Promise<PlatformResult> {
  const tool = requireTool(ctx, 'adb');
  const run = runnerFor(ctx, tool);
  const version =
    (await text(ctx, run, adb.version(), 'adb version'))?.split('\n')[0].trim() ?? null;
  const device = await connectedDevice(ctx, run, opts.serial);
  const model =
    (await text(ctx, run, adb.getprop(device.serial, 'ro.product.model'), 'adb getprop')) ??
    device.model;
  const release = await text(
    ctx,
    run,
    adb.getprop(device.serial, 'ro.build.version.release'),
    'adb getprop',
  );
  const driver = opts.cleanStatusBar ? androidDriver(run, device.serial) : null;
  const report = newReport(driver);
  ctx.out.progress(`Capturing ${model ?? device.serial}…`);
  try {
    const image = await withStatusBar(
      driver,
      report,
      { settleMs: opts.settleMs, signal: ctx.signal, notice: (m) => ctx.out.notice(m) },
      async () => {
        const label = 'adb exec-out screencap';
        const r = await run(adb.screencap(device.serial), {
          timeoutMs: opts.timeoutMs,
          signal: ctx.signal,
          label,
          maxStdout: SCREENCAP_CAP,
        });
        if (r.code !== 0)
          throw new CliError(
            'CAPTURE_FAILED',
            `${label} failed (exit ${r.code})${r.stderr ? `: ${tail(r.stderr)}` : ''}.`,
          );
        return new Uint8Array(r.stdout);
      },
    );
    return {
      tool: { name: 'adb', path: tool.path, version },
      target: {
        kind: 'android_device',
        id: device.serial,
        name: model,
        os: release ? `Android ${release}` : null,
      },
      images: [image],
      statusBar: report,
      manual: driver?.manual ?? null,
    };
  } finally {
    ctx.interrupt = { note: interruptNote(report, driver) };
  }
}
