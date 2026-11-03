import path from 'node:path';
import { parseCli } from '../../src/args.js';
import { resolveConfig } from '../../src/config.js';
import { createCtx, type Ctx } from '../../src/context.js';
import { Output } from '../../src/output.js';
import { fakeSdk, type FakeSdk } from './fakeSdk.js';
import { captured } from './streams.js';

export interface TestCtx {
  ctx: Ctx;
  sdk: FakeSdk;
  stdout(): string;
  stderr(): string;
  keys: (string | null)[];
}

/** A Ctx for `argv` with a fake SDK, captured streams and config under `home`. */
export function testCtx(
  argv: string[],
  opts: {
    home: string;
    env?: Record<string, string>;
    tty?: boolean;
    answer?: string | null;
    now?: () => number;
    controller?: AbortController;
  },
): TestCtx {
  const parsed = parseCli(argv);
  const env = { XDG_CONFIG_HOME: path.join(opts.home, 'config'), ...opts.env };
  const config = resolveConfig(
    {
      env: parsed.flags.env as string | undefined,
      apiKey: parsed.flags['api-key'] as string | undefined,
    },
    env,
    { homedir: opts.home },
  );
  const c = captured({ stderrTTY: opts.tty ?? false });
  const out = new Output(c.streams, {
    json: parsed.flags.json === true,
    quiet: parsed.flags.quiet === true,
    noColor: true,
    env,
  });
  const sdk = fakeSdk();
  const keys: (string | null)[] = [];
  const ctx = createCtx({
    args: parsed,
    config,
    out,
    signal: (opts.controller ?? new AbortController()).signal,
    cwd: opts.home,
    stdinIsTTY: opts.tty ?? false,
    now: opts.now ?? Date.now,
    createClient: (apiKey) => {
      keys.push(apiKey);
      return sdk as never;
    },
    prompt: async () => opts.answer ?? null,
    pollMs: 1,
  });
  return { ctx, sdk, stdout: c.stdout, stderr: c.stderr, keys };
}
