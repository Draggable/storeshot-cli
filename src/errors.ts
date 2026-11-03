import { StoreshotError, type ErrorCode, type SdkErrorCode } from '@draggable/storeshot-sdk';
import { McpToolError, type LocalErrorCode } from './shared/mcp.js';

/** Spec §12. Stable: changing a value needs schemaVersion 2. */
export const EXIT = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  AUTH: 3,
  CREDITS: 4,
  NOT_FOUND: 5,
  RATE_LIMITED: 6,
  SERVER: 7,
  NETWORK: 8,
  PARTIAL: 9,
  WAIT_TIMEOUT: 10,
  CONFIRMATION: 11,
  FILE: 12,
  INTERRUPTED: 130,
  TERMINATED: 143,
} as const;

export type CliCode =
  | 'USAGE'
  | 'ENVIRONMENT_MISMATCH'
  | 'NOT_LOGGED_IN'
  | 'PARTIAL_FAILURE'
  | 'NOT_READY'
  | 'CONFIRMATION_REQUIRED'
  | 'SPEND_DECLINED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'INTERRUPTED'
  | 'INTERNAL_ERROR'
  | 'CAPTURE_TOOL_MISSING'
  | 'CAPTURE_DEVICE_NOT_FOUND'
  | 'CAPTURE_DEVICE_AMBIGUOUS'
  | 'CAPTURE_FAILED'
  | 'STATUS_BAR_NOT_RESTORED';
export type AnyCode = CliCode | LocalErrorCode | ErrorCode | SdkErrorCode;
export type KeySource = 'flag' | 'env' | 'stored';

// Records keyed by the SDK/MCP unions: a code added there is a type error here until mapped.
const API: Record<ErrorCode, number> = {
  INVALID_INPUT: 2,
  UNAUTHORIZED: 3,
  FORBIDDEN: 3,
  NOT_FOUND: 5,
  METHOD_NOT_ALLOWED: 7,
  PAYLOAD_TOO_LARGE: 2,
  UPLOAD_NOT_READY: 2,
  IDEMPOTENCY_CONFLICT: 2,
  GENERATION_STATE_CONFLICT: 2,
  SCREENSHOT_SET_STATE_CONFLICT: 2,
  WEBHOOK_STATE_CONFLICT: 2,
  BILLING_STATE_CONFLICT: 2,
  IMAGE_TOO_LARGE: 2,
  UNSUPPORTED_FORMAT: 2,
  NOT_A_SCREENSHOT: 2,
  URL_FETCH_FAILED: 2,
  WEBHOOK_URL_REJECTED: 2,
  INSUFFICIENT_CREDITS: 4,
  RATE_LIMITED: 6,
  CONCURRENCY_LIMITED: 6,
  INTERNAL_ERROR: 1,
  GENERATION_FAILED: 9,
  SERVICE_UNAVAILABLE: 7,
  BILLING_UNAVAILABLE: 7,
  GENERATION_TIMEOUT: 9,
};
const SDK: Record<SdkErrorCode, number> = {
  MISSING_API_KEY: 3,
  INVALID_CONFIGURATION: 2,
  BROWSER_NOT_ALLOWED: 2,
  CONNECTION_ERROR: 8,
  TIMEOUT: 8,
  WAIT_TIMEOUT: 10,
  UNEXPECTED_RESPONSE: 7,
  FILE_TOO_LARGE: 12,
  NODE_ONLY: 12,
  WEBHOOK_SIGNATURE_INVALID: 1,
  WEBHOOK_PAYLOAD_INVALID: 1,
  DEVICE_ACCESS_DENIED: 3,
  DEVICE_CODE_EXPIRED: 3,
  DEVICE_INVALID_GRANT: 3,
};
const LOCAL: Record<LocalErrorCode, number> = {
  ACCOUNT_LINK_REQUIRED: 3,
  ACCOUNT_LINK_PENDING: 3,
  INVALID_CONFIGURATION: 2,
  PATH_NOT_ALLOWED: 12,
  NOT_A_FILE: 12,
  FILE_TOO_LARGE: 12,
  UNSUPPORTED_FILE_TYPE: 12,
  FILE_EXISTS: 12,
  UNSAFE_ARCHIVE: 12,
  DOWNLOAD_TOO_LARGE: 12,
  NO_RESULT: 12,
  INVALID_ARGUMENTS: 2,
};
const CLI: Record<CliCode, number> = {
  USAGE: 2,
  ENVIRONMENT_MISMATCH: 2,
  NOT_LOGGED_IN: 3,
  PARTIAL_FAILURE: 9,
  NOT_READY: 10,
  CONFIRMATION_REQUIRED: 11,
  SPEND_DECLINED: 11,
  SPEND_LIMIT_EXCEEDED: 11,
  INTERRUPTED: 130,
  INTERNAL_ERROR: 1,
  CAPTURE_TOOL_MISSING: 12,
  CAPTURE_DEVICE_NOT_FOUND: 5,
  CAPTURE_DEVICE_AMBIGUOUS: 2,
  CAPTURE_FAILED: 12,
  STATUS_BAR_NOT_RESTORED: 12,
};
const TABLE: Record<string, number> = { ...API, ...SDK, ...LOCAL, ...CLI };

export function exitCodeOf(code: string, status: number | null): number {
  const known = TABLE[code];
  if (known !== undefined) return known;
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 402) return EXIT.CREDITS;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 429) return EXIT.RATE_LIMITED;
  if (status !== null && status >= 500) return EXIT.SERVER;
  if (status !== null && status >= 400) return EXIT.USAGE;
  return EXIT.INTERNAL;
}

/** An error of this CLI (spec §12 codes); `data` is reported in the envelope even on failure. */
export class CliError extends Error {
  constructor(
    readonly code: AnyCode,
    message: string,
    readonly opts: {
      hint?: string;
      details?: Record<string, unknown>;
      data?: unknown;
      /** Human result lines still printed on stdout (partial sets, timeouts). */
      human?: string[];
      exitCode?: number;
    } = {},
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export interface Failure {
  code: string;
  message: string;
  hint: string;
  status: number | null;
  requestId: string | null;
  docUrl: string | null;
  retryAfterSeconds: number | null;
  details?: Record<string, unknown>;
  exitCode: number;
  data?: unknown;
  human?: string[];
}

/** The API detail keys worth showing (the MCP DETAIL_KEYS + the CLI's). */
const DETAIL_KEYS = [
  'path',
  'requiredCredits',
  'availableCredits',
  'topUpUrl',
  'status',
  'action',
  'images',
  'screenshotSetId',
  'retryAfter',
  'error',
  'files',
  'quote',
  'id',
];
const pick = (details: Record<string, unknown> | undefined) => {
  if (!details) return undefined;
  const out = Object.fromEntries(Object.entries(details).filter(([k]) => DETAIL_KEYS.includes(k)));
  return Object.keys(out).length ? out : undefined;
};

type HintInput = {
  details?: Record<string, unknown>;
  retryAfterSeconds: number | null;
  keySource: KeySource | null;
};
const idOf = (h: HintInput) => (typeof h.details?.id === 'string' ? h.details.id : '<id>');
const FILES = 'Pass PNG, JPEG or WebP screenshots of at most 20 MiB.';
const SUPPORT = 'Report this to support@storeshot.art with the id and the request id.';
const HINTS: Record<string, (h: HintInput) => string> = {
  USAGE: () => 'Run storeshot <command> --help.',
  ENVIRONMENT_MISMATCH: () =>
    'Drop --env / STORESHOT_ENVIRONMENT, or pass a key of that environment.',
  INVALID_CONFIGURATION: () =>
    'Fix the setting named above (STORESHOT_BASE_URL, STORESHOT_API_KEY or STORESHOT_ENVIRONMENT).',
  NOT_LOGGED_IN: () => 'Run storeshot login (a free test key), or set STORESHOT_API_KEY.',
  MISSING_API_KEY: () => 'Run storeshot login (a free test key), or set STORESHOT_API_KEY.',
  UNAUTHORIZED: (h) =>
    h.keySource === 'stored'
      ? 'The stored key was revoked or has expired and has been forgotten: run storeshot login.'
      : 'The key is invalid or revoked: create a new one at https://console.storeshot.art/keys.',
  FORBIDDEN: () =>
    'The key lacks a scope this command needs (see details): run storeshot login again or use a key with that scope.',
  DEVICE_ACCESS_DENIED: () =>
    'The request was denied in the console: run storeshot login to start again.',
  DEVICE_CODE_EXPIRED: () => 'The code expired before it was approved: run storeshot login again.',
  DEVICE_INVALID_GRANT: () => 'The code is unknown or was already used: run storeshot login again.',
  INSUFFICIENT_CREDITS: (h) =>
    `Buy credits at ${String(h.details?.topUpUrl ?? 'https://console.storeshot.art/billing')}, or use --env test (free sample images).`,
  NOT_FOUND: () => 'Check the id; pass --kind set|generation if you know it.',
  RATE_LIMITED: (h) => `Wait ${h.retryAfterSeconds ?? 60} s and run the command again.`,
  CONCURRENCY_LIMITED: () =>
    'Too many jobs are running: wait for them (storeshot status <id> --wait), then retry.',
  SERVICE_UNAVAILABLE: () => 'Storeshot is busy: retry later (https://storeshot.art/status).',
  BILLING_UNAVAILABLE: () => 'Billing is unavailable: retry later (https://storeshot.art/status).',
  UNEXPECTED_RESPONSE: () => 'Retry later; if it persists, report it with the request id.',
  CONNECTION_ERROR: () => 'Check the network (and STORESHOT_BASE_URL if you set it), then retry.',
  TIMEOUT: () => 'Check the network (and STORESHOT_BASE_URL if you set it), then retry.',
  PARTIAL_FAILURE: (h) =>
    `Failed images were refunded with a live key. Save the others with storeshot pull ${idOf(h)}, or run the command again.`,
  GENERATION_FAILED: () =>
    'The image failed and was refunded with a live key: run the command again.',
  GENERATION_TIMEOUT: () =>
    'The image took too long and was refunded with a live key: run the command again.',
  WAIT_TIMEOUT: (h) =>
    `The job continues on Storeshot: storeshot status ${idOf(h)} --wait, then storeshot pull ${idOf(h)}.`,
  NOT_READY: (h) => `Not finished yet: storeshot status ${idOf(h)} --wait.`,
  CONFIRMATION_REQUIRED: () =>
    'Pass --yes to spend the credits shown (add --max-credits <n> to cap), or use --env test (free).',
  SPEND_DECLINED: () => 'Nothing was created or charged.',
  SPEND_LIMIT_EXCEEDED: () =>
    'Nothing was created or charged: raise --max-credits, or pass fewer devices or screens.',
  FILE_EXISTS: () => 'Pass --force to replace them, or choose another --out folder.',
  PATH_NOT_ALLOWED: () => 'Use a folder you own, without symbolic links on the way.',
  NOT_A_FILE: () => FILES,
  FILE_TOO_LARGE: () => FILES,
  UNSUPPORTED_FILE_TYPE: () => FILES,
  UNSUPPORTED_FORMAT: () => FILES,
  IMAGE_TOO_LARGE: () => 'Use an image of at most 16384 px per side and 50 megapixels.',
  NOT_A_SCREENSHOT: () => 'Use a real app screenshot (phone or tablet proportions).',
  UNSAFE_ARCHIVE: () => SUPPORT,
  DOWNLOAD_TOO_LARGE: () => SUPPORT,
  NO_RESULT: (h) => `The image is not ready: storeshot status ${idOf(h)} --wait.`,
  INTERRUPTED: (h) =>
    h.details?.id
      ? `It continues on Storeshot: storeshot status ${idOf(h)}.`
      : 'Nothing was created.',
  CAPTURE_TOOL_MISSING: () =>
    'storeshot capture never installs tools: install the one named above, then run it again.',
  CAPTURE_DEVICE_NOT_FOUND: () =>
    'Start the simulator or emulator first (or plug in the device), then run it again.',
  CAPTURE_DEVICE_AMBIGUOUS: () => 'Pass --udid (iOS) or --serial (Android): see details.devices.',
  CAPTURE_FAILED: () =>
    'Check that the app shows the screen you want, then run it again (raise --timeout if it is slow).',
  STATUS_BAR_NOT_RESTORED: () =>
    'Run the command named above, or storeshot capture ios|android --reset-status-bar.',
  INTERNAL_ERROR: () =>
    'Run it again; if it happens again, report it to support@storeshot.art with the output.',
  INVALID_INPUT: () =>
    'Fix the input named in details.path (storeshot devices lists the device ids).',
  IDEMPOTENCY_CONFLICT: () =>
    'An --idempotency-key can only repeat the same request: drop it or use a new one.',
};
const hintFor = (code: string, h: HintInput) =>
  (HINTS[code] ?? (() => 'See the docs URL for this error.'))(h);

export function toFailure(error: unknown, ctx: { keySource: KeySource | null }): Failure {
  if (error instanceof CliError) {
    const h = { details: error.opts.details, retryAfterSeconds: null, keySource: ctx.keySource };
    return {
      code: error.code,
      message: error.message,
      hint: error.opts.hint ?? hintFor(error.code, h),
      status: null,
      requestId: null,
      docUrl: null,
      retryAfterSeconds: null,
      details: error.opts.details,
      exitCode: error.opts.exitCode ?? exitCodeOf(error.code, null),
      data: error.opts.data,
      human: error.opts.human,
    };
  }
  if (error instanceof McpToolError) {
    const h = { details: error.details, retryAfterSeconds: null, keySource: ctx.keySource };
    return {
      code: error.code,
      message: error.message,
      hint: hintFor(error.code, h),
      status: null,
      requestId: null,
      docUrl: null,
      retryAfterSeconds: null,
      details: error.details,
      exitCode: exitCodeOf(error.code, null),
    };
  }
  if (error instanceof StoreshotError) {
    const details = pick(error.details);
    const h = { details, retryAfterSeconds: error.retryAfterSeconds, keySource: ctx.keySource };
    return {
      code: error.code,
      message: error.message,
      hint: hintFor(error.code, h),
      status: error.status || null,
      requestId: error.requestId,
      docUrl: error.docUrl,
      retryAfterSeconds: error.retryAfterSeconds,
      details,
      exitCode: exitCodeOf(error.code, error.status || null),
    };
  }
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'INTERNAL_ERROR',
    message: `Unexpected error in storeshot (${name}): ${message}`.slice(0, 500),
    hint: hintFor('INTERNAL_ERROR', { retryAfterSeconds: null, keySource: ctx.keySource }),
    status: null,
    requestId: null,
    docUrl: null,
    retryAfterSeconds: null,
    exitCode: EXIT.INTERNAL,
  };
}
