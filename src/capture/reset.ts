import { str } from '../args.js';
import type { CommandResult } from '../commands/types.js';
import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import type { Form } from './forms.js';
import { connectedDevice } from './runAndroid.js';
import { bootedSimulator } from './runIos.js';
import { requireTool, runnerFor } from './runner.js';
import { androidDriver, iosDriver, type StatusBarDriver } from './statusBar.js';
import type { Target } from './types.js';

/** Spec §3, §10.3: `capture ios|android --reset-status-bar` restores without capturing. */
export async function resetStatusBar(ctx: Ctx, form: Form): Promise<CommandResult> {
  if (form === 'web') throw new CliError('USAGE', 'capture web has no status bar.');
  const tool = requireTool(ctx, form === 'ios' ? 'xcrun' : 'adb');
  const run = runnerFor(ctx, tool);
  let driver: StatusBarDriver;
  let target: Target;
  if (form === 'ios') {
    const sim = await bootedSimulator(ctx, run, str(ctx.args, 'udid'));
    driver = iosDriver(run, sim.udid);
    target = { kind: 'simulator', id: sim.udid, name: sim.name, os: sim.os };
  } else {
    const device = await connectedDevice(ctx, run, str(ctx.args, 'serial'));
    driver = androidDriver(run, device.serial);
    target = { kind: 'android_device', id: device.serial, name: device.model, os: null };
    ctx.out.warn(
      'Demo mode ends; sysui_demo_allowed is left as it is (its earlier value is unknown).',
    );
  }
  const restored = await driver.restore().then(
    () => true,
    () => false,
  );
  const data = {
    mode: 'reset_status_bar' as const,
    platform: form,
    folder: null,
    tool: { name: tool.name, path: tool.path, version: null },
    target,
    preset: null,
    screens: [],
    captions: null,
    statusBar: { requested: true, method: driver.method, applied: false, restored },
    next: null,
  };
  if (!restored) {
    throw new CliError('STATUS_BAR_NOT_RESTORED', 'The status bar could not be restored.', {
      data,
      hint: `Run ${driver.manual} by hand.`,
    });
  }
  return { data, human: [`Status bar of ${target.name ?? target.id} restored.`] };
}
