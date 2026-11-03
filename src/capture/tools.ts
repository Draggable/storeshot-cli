// Spec §5: the only place that starts child processes. Argument arrays, no shell, an
// environment without STORESHOT_* variables, timeouts, SIGTERM → SIGKILL, output caps.
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../errors.js';
import { stripControl } from '../output.js';

export interface Tool {
  name: string;
  path: string;
}
export type Env = Record<string, string | undefined>;
export interface RunOptions {
  timeoutMs: number;
  env: Record<string, string>;
  cwd: string;
  /** Names the call in errors ("xcrun simctl io screenshot"). */
  label: string;
  /** Capture calls pass ctx.signal; restore calls never do (spec §10.3). */
  signal?: AbortSignal;
  maxStdout?: number;
}
export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}
/** A tool bound to the child environment and cwd (src/capture/runner.ts). */
export type Runner = (
  args: string[],
  opts: { timeoutMs: number; label: string; signal?: AbortSignal; maxStdout?: number },
) => Promise<RunResult>;

const STDERR_CAP = 64 * 1024;
const STDOUT_CAP = 4 * 1024 * 1024;
const KILL_GRACE_MS = 2000;

/** File names tried per PATH entry. Windows: .exe/.com only (.cmd/.bat would need a shell). */
export const candidates = (name: string, platform: NodeJS.Platform): string[] =>
  platform === 'win32' ? [`${name}.exe`, `${name}.com`] : [name];

/** Spec §5.1: the first executable `name` in an absolute PATH entry; relative entries ignored. */
export function findTool(
  name: string,
  env: Env,
  opts: { platform?: NodeJS.Platform; warn?: (m: string) => void } = {},
): Tool | null {
  const platform = opts.platform ?? process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const entries = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':');
  const relative = entries.filter((e) => e !== '' && !p.isAbsolute(e));
  if (relative.length) opts.warn?.(`Ignoring relative PATH entries: ${relative.join(', ')}.`);
  for (const dir of entries) {
    if (!dir || !p.isAbsolute(dir)) continue;
    for (const file of candidates(name, platform).map((n) => p.join(dir, n))) {
      try {
        if (!statSync(file).isFile()) continue;
        if (platform !== 'win32') accessSync(file, constants.X_OK);
        return { name, path: file };
      } catch {
        // not in this entry
      }
    }
  }
  return null;
}

/** Spec §5.3: never pass a Storeshot key or setting to a child process. */
export function childEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !/^STORESHOT_/i.test(key)) out[key] = value;
  }
  return out;
}

/** The last 2 KiB of a tool's stderr, without control characters (spec §5.5). */
export const tail = (text: string): string => stripControl(text).trim().slice(-2048);

export function runTool(tool: Tool, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const cap = opts.maxStdout ?? STDOUT_CAP;
    let child: ChildProcess;
    try {
      child = spawn(tool.path, args, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        new CliError(
          'CAPTURE_FAILED',
          `${opts.label} could not be started: ${(error as Error).message}`,
        ),
      );
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let failure: CliError | null = null;
    let killer: NodeJS.Timeout | undefined;
    const stop = (error: CliError) => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    };
    const timer = setTimeout(
      () =>
        stop(
          new CliError(
            'CAPTURE_FAILED',
            `${opts.label} timed out after ${opts.timeoutMs / 1000} s.`,
          ),
        ),
      opts.timeoutMs,
    );
    const onAbort = () => stop(new CliError('CAPTURE_FAILED', `${opts.label} stopped.`));
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => {
      clearTimeout(timer);
      clearTimeout(killer);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    child.stdout!.on('data', (b: Buffer) => {
      size += b.length;
      if (size > cap)
        stop(new CliError('CAPTURE_FAILED', `${opts.label} wrote more than ${cap} bytes.`));
      else chunks.push(b);
    });
    child.stderr!.on('data', (b: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += b.toString('utf8');
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      done();
      reject(
        e.code === 'ENOENT' || e.code === 'EACCES'
          ? new CliError(
              'CAPTURE_TOOL_MISSING',
              `${tool.name} could not be started (${tool.path}: ${e.code}).`,
            )
          : new CliError('CAPTURE_FAILED', `${opts.label} could not be started: ${e.message}`),
      );
    });
    child.on('close', (code) => {
      done();
      if (failure) reject(failure);
      else resolve({ code, stdout: Buffer.concat(chunks), stderr: stderr.slice(0, STDERR_CAP) });
    });
  });
}
