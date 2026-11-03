import { format } from 'node:util';

export type Write = (text: string) => void;
export type Logger = (message: string) => void;

export const stderrWrite: Write = (text) => {
  process.stderr.write(text);
};

/**
 * stdout is the MCP protocol (spec §11): every console method that would print there is sent to
 * stderr instead, before bin.ts imports anything else.
 */
export function guardStdout(target: Console = console, write: Write = stderrWrite): void {
  for (const method of ['log', 'info', 'debug', 'warn'] as const) {
    target[method] = (...args: unknown[]) => write(`${format(...args)}\n`);
  }
}

/**
 * One `[storeshot-mcp] …` line per message; every secret in `secrets` (a live array: keys are
 * pushed once known) is replaced by its first 8 characters.
 */
export function createLogger(write: Write = stderrWrite, secrets: string[] = []): Logger {
  return (message) => {
    let text = message.replace(/[\r\n]+/g, ' ');
    for (const secret of secrets) {
      if (secret) text = text.split(secret).join(`${secret.slice(0, 8)}…`);
    }
    write(`[storeshot-mcp] ${text}\n`);
  };
}
