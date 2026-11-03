import { describe, expect, it } from 'vitest';
import {
  androidDriver,
  interruptNote,
  iosDriver,
  newReport,
  withStatusBar,
} from '../../src/capture/statusBar.js';
import type { Runner } from '../../src/capture/tools.js';

const U = 'AAAAAAAA-1111-4111-8111-111111111111';
type Call = { args: string[]; signal: AbortSignal | undefined };
function fake(opts: { fail?: (a: string[]) => boolean; demoAllowed?: string } = {}) {
  const calls: Call[] = [];
  const run: Runner = async (args, o) => {
    calls.push({ args, signal: o.signal });
    const failed = opts.fail?.(args) ?? false;
    const out = args.includes('get') ? `${opts.demoAllowed ?? 'null'}\n` : '';
    return { code: failed ? 1 : 0, stdout: Buffer.from(out), stderr: failed ? 'boom' : '' };
  };
  return {
    run,
    calls,
    words: () => calls.map((c) => c.args.slice(c.args.indexOf('shell') + 1).join(' ')),
  };
}
const noSleep = async () => {};
const opts = (signal = new AbortController().signal, notices: string[] = []) => ({
  settleMs: 0,
  signal,
  notice: (m: string) => notices.push(m),
  sleep: noSleep,
});

describe('status bar (spec §10)', () => {
  it('iOS: override, fn, clear; restore never gets the abort signal', async () => {
    const f = fake();
    const d = iosDriver(f.run, U);
    const report = newReport(d);
    expect(await withStatusBar(d, report, opts(), async () => 'shot')).toBe('shot');
    expect(f.calls.map((c) => c.args[3])).toEqual(['override', 'clear']);
    expect(f.calls[1].signal).toBeUndefined();
    expect(report).toEqual({
      requested: true,
      method: 'simctl_status_bar',
      applied: true,
      restored: true,
    });
  });
  it('restores after fn throws and rethrows', async () => {
    const f = fake();
    const d = iosDriver(f.run, U);
    const report = newReport(d);
    await expect(
      withStatusBar(d, report, opts(), async () => {
        throw new Error('capture failed');
      }),
    ).rejects.toThrow('capture failed');
    expect(f.calls.at(-1)!.args[3]).toBe('clear');
    expect(report.restored).toBe(true);
  });
  it('restores after a half-applied override (Android third broadcast fails)', async () => {
    const f = fake({ fail: (a) => a.includes('wifi') });
    const d = androidDriver(f.run, 'emulator-5554');
    const report = newReport(d);
    await expect(withStatusBar(d, report, opts(), async () => 'x')).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
    });
    expect(report.applied).toBe(false);
    expect(f.words().slice(-2)).toEqual([
      'am broadcast -a com.android.systemui.demo -e command exit',
      'settings delete global sysui_demo_allowed',
    ]);
    expect(report.restored).toBe(true);
  });
  it('Android puts back the earlier sysui_demo_allowed value', async () => {
    for (const [before, last] of [
      ['null', 'settings delete global sysui_demo_allowed'],
      ['0', 'settings put global sysui_demo_allowed 0'],
      ['1', 'am broadcast -a com.android.systemui.demo -e command exit'],
    ]) {
      const f = fake({ demoAllowed: before });
      const d = androidDriver(f.run, 'emulator-5554');
      await withStatusBar(d, newReport(d), opts(), async () => 'x');
      expect(f.words()[0]).toBe('settings get global sysui_demo_allowed');
      expect(f.words()[1]).toBe('settings put global sysui_demo_allowed 1');
      expect(f.words().at(-1), before).toBe(last);
    }
  });
  it('a failed restore is reported, not thrown', async () => {
    const f = fake({ fail: (a) => a.includes('clear') });
    const d = iosDriver(f.run, U);
    const report = newReport(d);
    await withStatusBar(d, report, opts(), async () => 'x');
    expect(report.restored).toBe(false);
    expect(interruptNote(report, d)).toBe(
      `Nothing was written. Status bar NOT restored: run xcrun simctl status_bar ${U} clear`,
    );
  });
  it('no driver: fn only; aborted: a notice before restoring', async () => {
    expect(await withStatusBar(null, newReport(null), opts(), async () => 1)).toBe(1);
    expect(interruptNote(newReport(null), null)).toBe('Nothing was written.');
    const c = new AbortController();
    const notices: string[] = [];
    const f = fake();
    const d = iosDriver(f.run, U);
    const report = newReport(d);
    await expect(
      withStatusBar(d, report, opts(c.signal, notices), async () => {
        c.abort();
        throw new Error('stopped');
      }),
    ).rejects.toThrow('stopped');
    expect(notices).toEqual(['Restoring the status bar (Ctrl-C again skips it)…']);
    expect(interruptNote(report, d)).toBe('Nothing was written. Status bar restored.');
  });
});
