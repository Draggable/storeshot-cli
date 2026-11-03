import { StoreshotError, type Storeshot } from '@draggable/storeshot-sdk';
import { bool, helpText, parseCli, str, type Parsed } from './args.js';
import { COMMAND_RUNNERS } from './commands/index.js';
import { resolveConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { CliError, toFailure } from './errors.js';
import { Output, envelope, type Streams } from './output.js';
import { CLI_VERSION } from './version.js';

export interface MainDeps {
  streams: Streams;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  signalName: () => 'SIGINT' | 'SIGTERM' | null;
  stdinIsTTY: boolean;
  cwd: string;
  homedir?: string;
  prompt: (question: string) => Promise<string | null>;
  createClient?: (apiKey: string | null) => Storeshot;
  now?: () => number;
  pollMs?: number;
}

/** Spec §4: parse, resolve, run one command, write exactly one result; returns the exit code. */
export async function main(argv: string[], deps: MainDeps): Promise<number> {
  const early = new Output(deps.streams, {
    json: argv.includes('--json'),
    quiet: argv.includes('--quiet'),
    noColor: argv.includes('--no-color'),
    env: deps.env,
  });
  const guess = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'storeshot';
  let parsed: Parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    return fail(early, guess, error, null, deps);
  }
  if (parsed.version) {
    early.raw(CLI_VERSION);
    return 0;
  }
  if (parsed.help) {
    early.raw(helpText(parsed.command));
    return parsed.bare ? 2 : 0;
  }
  const command = parsed.command!;
  const out = new Output(deps.streams, {
    json: bool(parsed, 'json'),
    quiet: bool(parsed, 'quiet'),
    noColor: bool(parsed, 'no-color'),
    env: deps.env,
  });
  let ctx: Ctx | null = null;
  try {
    const config = resolveConfig(
      { env: str(parsed, 'env'), apiKey: str(parsed, 'api-key') },
      deps.env,
      { homedir: deps.homedir },
    );
    if (config.explicitKey) out.addSecret(config.explicitKey.value);
    if (config.explicitKey?.source === 'flag') {
      out.warn(
        '--api-key is visible to other users of this machine (ps) and in shell history: prefer STORESHOT_API_KEY.',
      );
    }
    ctx = createCtx({
      args: parsed,
      config,
      out,
      signal: deps.signal,
      cwd: deps.cwd,
      env: deps.env,
      stdinIsTTY: deps.stdinIsTTY,
      prompt: deps.prompt,
      createClient: deps.createClient,
      now: deps.now,
      pollMs: deps.pollMs,
    });
    const result = await COMMAND_RUNNERS[command](ctx);
    if (result.raw !== undefined) out.raw(result.raw);
    else out.result(envelope(command, 0, result.data, null, out.warnings), result.human);
    return 0;
  } catch (error) {
    return fail(out, command, error, ctx, deps);
  }
}

function fail(
  out: Output,
  command: string,
  error: unknown,
  ctx: Ctx | null,
  deps: MainDeps,
): number {
  let err = error;
  const signal = deps.signalName();
  if (signal) {
    const job = ctx?.job;
    const what = job
      ? ` ${job.kind === 'generation' ? 'Generation' : 'Screenshot set'} ${job.id} continues on Storeshot.`
      : '';
    const note = ctx?.interrupt ? ` ${ctx.interrupt.note}` : '';
    err = new CliError('INTERRUPTED', `Stopped (${signal}).${what}${note}`, {
      exitCode: signal === 'SIGTERM' ? 143 : 130,
      details: job ? { id: job.id } : undefined,
    });
  }
  // Spec §7.3: a stored key the server refuses is forgotten (never an explicit one).
  if (
    ctx?.keySource === 'stored' &&
    ctx.keyEnvironment &&
    err instanceof StoreshotError &&
    err.status === 401
  ) {
    ctx.store.remove(ctx.config.baseUrl, ctx.keyEnvironment);
  }
  const failure = toFailure(err, { keySource: ctx?.keySource ?? null });
  out.errorLine(`${failure.message}\n${failure.hint}`);
  out.result(
    envelope(command, failure.exitCode, failure.data ?? null, failure, out.warnings),
    failure.human ?? [],
  );
  return failure.exitCode;
}
