import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { requireTool, runnerFor } from '../../src/capture/runner.js';
import { testCtx } from '../helpers/ctx.js';
import { tmpDir } from '../helpers/tmp.js';
import { installShims } from './shims/install.mjs';
import { makePng } from './shims/png.mjs';

const home = tmpDir('runner');
const shims = installShims({ png: makePng(400, 800) });
afterAll(() => {
  shims.cleanup();
  rmSync(home, { recursive: true, force: true });
});

describe('runner (spec §5)', () => {
  it('requireTool: found on PATH, or CAPTURE_TOOL_MISSING with a per-tool hint', () => {
    const t = testCtx(['capture', 'ios'], { home, env: shims.env });
    expect(requireTool(t.ctx, 'xcrun').path).toBe(`${shims.bin}/xcrun`);
    const none = testCtx(['capture', 'ios'], { home, env: { PATH: '/nonexistent' } });
    expect(() => requireTool(none.ctx, 'adb')).toThrow(/adb was not found on PATH/);
    try {
      requireTool(none.ctx, 'xcrun', 'linux');
    } catch (e) {
      expect((e as { opts: { hint: string } }).opts.hint).toBe(
        'capture ios needs macOS with Xcode (xcrun simctl).',
      );
    }
  });
  it('runnerFor: the child gets no STORESHOT_* variable and runs in ctx.cwd', async () => {
    const t = testCtx(['capture', 'android'], {
      home,
      env: {
        ...shims.env,
        STORESHOT_API_KEY: 'ss_test_' + 'z'.repeat(32),
        STORESHOT_BASE_URL: 'https://api.storeshot.art/v1',
      },
    });
    const run = runnerFor(t.ctx, requireTool(t.ctx, 'adb'));
    await run(['version'], { timeoutMs: 5000, label: 'adb version' });
    const call = shims.calls().at(-1)!;
    expect(Object.keys(call.env).filter((k) => /^storeshot_/i.test(k))).toEqual([]);
    expect(call.cwd).toBe(home);
  });
});
