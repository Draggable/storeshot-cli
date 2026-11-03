import { CliError } from '../errors.js';
import { DEMO_APPLY, adb } from './adb.js';
import { simctl } from './simctl.js';
import { tail, type Runner, type RunResult } from './tools.js';

export type StatusBarMethod = 'simctl_status_bar' | 'android_demo_mode';
export interface StatusBarDriver {
  method: StatusBarMethod;
  /** The command a human runs when the restore failed. */
  manual: string;
  apply(signal: AbortSignal): Promise<void>;
  /** Runs every restore step even if one fails; throws STATUS_BAR_NOT_RESTORED at the end. */
  restore(): Promise<void>;
}
export interface StatusBarReport {
  requested: boolean;
  method: StatusBarMethod | null;
  applied: boolean;
  restored: boolean | null;
}

const STEP_MS = 15_000;
const RESTORE_MS = 10_000;

async function ok(result: Promise<RunResult>, what: string): Promise<RunResult> {
  const r = await result;
  if (r.code !== 0) {
    const detail = r.stderr ? `: ${tail(r.stderr)}` : '';
    throw new CliError('CAPTURE_FAILED', `${what} failed (exit ${r.code})${detail}.`);
  }
  return r;
}

async function restoreAll(run: Runner, steps: [string[], string][]): Promise<void> {
  const failures: string[] = [];
  for (const [args, what] of steps) {
    // No signal: a Ctrl-C must not cancel the cleanup (spec §10.3).
    await ok(run(args, { timeoutMs: RESTORE_MS, label: what }), what).catch((e: Error) =>
      failures.push(e.message),
    );
  }
  if (failures.length) throw new CliError('STATUS_BAR_NOT_RESTORED', failures.join(' '));
}

export function iosDriver(run: Runner, udid: string): StatusBarDriver {
  return {
    method: 'simctl_status_bar',
    manual: `xcrun simctl status_bar ${udid} clear`,
    async apply(signal) {
      const what = 'xcrun simctl status_bar override';
      await ok(
        run(simctl.statusBarOverride(udid), { timeoutMs: STEP_MS, signal, label: what }),
        what,
      );
    },
    restore: () =>
      restoreAll(run, [[simctl.statusBarClear(udid), 'xcrun simctl status_bar clear']]),
  };
}

/** Spec §10.2. `before` is known only after apply() read it (unknown for --reset-status-bar). */
export function androidDriver(run: Runner, serial: string): StatusBarDriver {
  let before: string | undefined;
  return {
    method: 'android_demo_mode',
    manual: `adb -s ${serial} shell am broadcast -a com.android.systemui.demo -e command exit`,
    async apply(signal) {
      const step = (args: string[], what: string) =>
        ok(run(args, { timeoutMs: STEP_MS, signal, label: what }), what);
      const r = await step(adb.getDemoAllowed(serial), 'adb settings get sysui_demo_allowed');
      before = r.stdout.toString('utf8').trim();
      await step(adb.putDemoAllowed(serial, '1'), 'adb settings put sysui_demo_allowed');
      for (const command of DEMO_APPLY)
        await step(adb.demo(serial, command), `adb demo mode ${command}`);
    },
    restore() {
      const steps: [string[], string][] = [[adb.demo(serial, 'exit'), 'adb demo mode exit']];
      if (before === 'null' || before === '')
        steps.push([adb.deleteDemoAllowed(serial), 'adb settings delete sysui_demo_allowed']);
      else if (before === '0')
        steps.push([adb.putDemoAllowed(serial, '0'), 'adb settings put sysui_demo_allowed 0']);
      return restoreAll(run, steps);
    },
  };
}

export const newReport = (driver: StatusBarDriver | null): StatusBarReport => ({
  requested: driver !== null,
  method: driver?.method ?? null,
  applied: false,
  restored: null,
});

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CliError('CAPTURE_FAILED', 'Stopped.'));
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new CliError('CAPTURE_FAILED', 'Stopped.'));
      },
      { once: true },
    );
  });
}

/** Spec §10.3: apply → settle → fn, and restore in `finally` whatever happened. */
export async function withStatusBar<T>(
  driver: StatusBarDriver | null,
  report: StatusBarReport,
  opts: {
    settleMs: number;
    signal: AbortSignal;
    notice: (message: string) => void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (!driver) return fn();
  try {
    await driver.apply(opts.signal);
    report.applied = true;
    await (opts.sleep ?? abortableSleep)(opts.settleMs, opts.signal);
    return await fn();
  } finally {
    if (opts.signal.aborted) opts.notice('Restoring the status bar (Ctrl-C again skips it)…');
    report.restored = await driver.restore().then(
      () => true,
      () => false,
    );
  }
}

/** Spec §10.3: appended to the INTERRUPTED message by main.fail(). */
export function interruptNote(report: StatusBarReport, driver: StatusBarDriver | null): string {
  if (!driver) return 'Nothing was written.';
  return report.restored === false
    ? `Nothing was written. Status bar NOT restored: run ${driver.manual}`
    : 'Nothing was written. Status bar restored.';
}
