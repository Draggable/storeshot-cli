import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { childEnv, findTool, runTool, type Runner, type Tool } from './tools.js';

export const XCODE_HINT =
  'Install Xcode, open it once, then run: sudo xcode-select -s /Applications/Xcode.app';
const HINTS = {
  adb: 'Install the Android SDK platform-tools and put platform-tools on PATH (Android Studio: $ANDROID_HOME/platform-tools).',
  xcrunOther: 'capture ios needs macOS with Xcode (xcrun simctl).',
};

/** Spec §5.1: PATH only, never installs; the hint names what to install. */
export function requireTool(
  ctx: Ctx,
  name: 'xcrun' | 'adb',
  platform: NodeJS.Platform = process.platform,
): Tool {
  const tool = findTool(name, ctx.env, { platform, warn: (m) => ctx.out.warn(m) });
  if (tool) return tool;
  const hint = name === 'adb' ? HINTS.adb : platform === 'darwin' ? XCODE_HINT : HINTS.xcrunOther;
  throw new CliError('CAPTURE_TOOL_MISSING', `${name} was not found on PATH.`, { hint });
}

/** Spec §5.2–§5.3: the tool with the child environment (no STORESHOT_*) and cwd. */
export function runnerFor(ctx: Ctx, tool: Tool): Runner {
  const env = childEnv(ctx.env);
  return (args, opts) => runTool(tool, args, { ...opts, env, cwd: ctx.cwd });
}
