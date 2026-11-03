/** Captured stdout/stderr with a chosen TTY flag (no real terminal). */
export function captured(opts: { stdoutTTY?: boolean; stderrTTY?: boolean } = {}) {
  let out = '';
  let err = '';
  return {
    streams: {
      stdout: { write: (t: string) => (out += t), isTTY: opts.stdoutTTY ?? false },
      stderr: { write: (t: string) => (err += t), isTTY: opts.stderrTTY ?? false },
    },
    stdout: () => out,
    stderr: () => err,
  };
}
