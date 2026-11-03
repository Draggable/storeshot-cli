import type { Failure } from './errors.js';

export interface Writable {
  write(text: string): unknown;
  isTTY?: boolean;
}
export interface Streams {
  stdout: Writable;
  stderr: Writable;
}
export interface OutputOptions {
  json: boolean;
  quiet: boolean;
  noColor: boolean;
  env: Record<string, string | undefined>;
}
export interface JsonError {
  code: string;
  message: string;
  hint: string;
  status: number | null;
  requestId: string | null;
  docUrl: string | null;
  retryAfterSeconds: number | null;
  details?: Record<string, unknown>;
}
export interface Envelope {
  schemaVersion: 1;
  command: string;
  ok: boolean;
  exitCode: number;
  data: unknown;
  warnings: string[];
  error: JsonError | null;
}

/** C0 (except \n), DEL and C1: server strings never move the cursor or retitle the terminal. */
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
export const stripControl = (text: string): string => text.replace(CONTROL, '');
const ERASE = '\r\u001b[2K';
/**
 * PM M5 (the SS-021 F1 lesson): besides the exact secrets this run knows, only real secret shapes
 * are masked (Storeshot API keys, bearer values), never words like `code`, `state` or error text.
 */
const KEY_SHAPE = /\bss_(?:live|test)_[A-Za-z0-9]{20,128}\b/g;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g;
const MIN_SECRET_LENGTH = 16;

export function envelope(
  command: string,
  exitCode: number,
  data: unknown,
  failure: Failure | null,
  warnings: string[],
): Envelope {
  const error: JsonError | null = failure
    ? {
        code: failure.code,
        message: failure.message,
        hint: failure.hint,
        status: failure.status,
        requestId: failure.requestId,
        docUrl: failure.docUrl,
        retryAfterSeconds: failure.retryAfterSeconds,
        ...(failure.details ? { details: failure.details } : {}),
      }
    : null;
  return {
    schemaVersion: 1,
    command,
    ok: exitCode === 0,
    exitCode,
    data: data ?? null,
    warnings,
    error,
  };
}

/**
 * Spec §11: stdout carries the one result (human lines or one JSON document); stderr carries
 * notices, warnings, errors and progress. Every write is scrubbed of known secrets.
 */
export class Output {
  readonly secrets: string[] = [];
  readonly warnings: string[] = [];
  private written = false;
  private lastKey: string | null = null;
  private shown = false;
  private lastDraw = 0;

  constructor(
    private readonly streams: Streams,
    readonly opts: OutputOptions,
    private readonly now: () => number = Date.now,
  ) {}

  get colour(): boolean {
    const e = this.opts.env;
    return (
      Boolean(this.streams.stderr.isTTY) &&
      !this.opts.json &&
      !this.opts.noColor &&
      !e.NO_COLOR &&
      e.TERM !== 'dumb'
    );
  }

  private get redraw(): boolean {
    return Boolean(this.streams.stderr.isTTY) && !this.opts.json;
  }

  /** A human can answer a prompt on stderr (spend confirmation, spec §10). */
  get stderrIsTTY(): boolean {
    return Boolean(this.streams.stderr.isTTY);
  }

  /** Exact secrets of this run (keys, device codes); short values are never treated as secrets. */
  addSecret(secret: string | null | undefined): void {
    if (secret && secret.length >= MIN_SECRET_LENGTH && !this.secrets.includes(secret)) {
      this.secrets.push(secret);
    }
  }

  scrub(text: string): string {
    let out = text;
    for (const s of this.secrets) out = out.split(s).join(`${s.slice(0, 8)}…`);
    return out.replace(KEY_SHAPE, (k) => `${k.slice(0, 8)}…`).replace(BEARER, '$1…');
  }

  private clean(text: string): string {
    return stripControl(this.scrub(text));
  }

  private paint(text: string, sgr: string): string {
    return this.colour ? `\u001b[${sgr}m${text}\u001b[0m` : text;
  }

  private line(text: string): void {
    this.clearProgress();
    this.streams.stderr.write(`${text}\n`);
  }

  notice(message: string): void {
    if (!this.opts.quiet) this.line(this.clean(message));
  }

  warn(message: string): void {
    const text = this.clean(message);
    this.warnings.push(text);
    this.line(this.paint(`warning: ${text}`, '1'));
  }

  errorLine(message: string): void {
    this.line(this.paint(`error: ${this.clean(message)}`, '31'));
  }

  /** TTY: one redrawn line (≤ 4/s). Otherwise: one line whenever `key` changes. */
  progress(text: string, key: string = text): void {
    if (this.opts.quiet) return;
    const clean = this.clean(text);
    if (this.redraw) {
      if (this.shown && this.now() - this.lastDraw < 250) return;
      this.lastDraw = this.now();
      this.streams.stderr.write(`${ERASE}${this.paint(clean, '2')}`);
      this.shown = true;
      return;
    }
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.streams.stderr.write(`${clean}\n`);
  }

  clearProgress(): void {
    if (!this.shown) return;
    this.streams.stderr.write(ERASE);
    this.shown = false;
  }

  /** The one result of the run (spec §11.1). */
  result(doc: Envelope, human: string[]): void {
    if (this.written) throw new Error('result written twice');
    this.written = true;
    this.clearProgress();
    if (this.opts.json) {
      this.streams.stdout.write(`${this.scrub(JSON.stringify(doc))}\n`);
      return;
    }
    for (const text of human) this.streams.stdout.write(`${this.clean(text)}\n`);
  }

  /** Help and `schema`: raw text instead of an envelope (spec §8.8, §11.1). */
  raw(text: string): void {
    if (this.written) throw new Error('result written twice');
    this.written = true;
    this.streams.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}
