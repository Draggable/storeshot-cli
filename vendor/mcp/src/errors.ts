import { StoreshotError } from '@draggable/storeshot-sdk';

export type LocalErrorCode =
  | 'ACCOUNT_LINK_REQUIRED'
  | 'ACCOUNT_LINK_PENDING'
  | 'INVALID_CONFIGURATION'
  | 'PATH_NOT_ALLOWED'
  | 'NOT_A_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_EXISTS'
  | 'UNSAFE_ARCHIVE'
  | 'DOWNLOAD_TOO_LARGE'
  | 'NO_RESULT'
  | 'INVALID_ARGUMENTS';
/** `oauth` (SS-021): a remote MCP connection, not a key the user configured. */
export type KeySource = 'env' | 'stored' | 'device' | 'oauth';

/** An error of this package (never an API code, never in the contract; spec §8). */
export class McpToolError extends Error {
  constructor(
    readonly code: LocalErrorCode,
    message: string,
    readonly next: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

export interface ToolError {
  code: string;
  status: number | null;
  message: string;
  requestId: string | null;
  docUrl: string | null;
  retryAfterSeconds: number | null;
  next: string;
  details?: Record<string, unknown>;
}

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
];

type Next = (e: StoreshotError, keySource: KeySource | null) => string;
const NEXT: Record<string, Next> = {
  INSUFFICIENT_CREDITS: (e, source) =>
    source === 'oauth'
      ? `Buy credits at ${String(e.details?.topUpUrl ?? 'https://console.storeshot.art/billing')}, or reconnect Storeshot with a Test connection to try for free.`
      : `Buy credits at ${String(e.details?.topUpUrl ?? 'https://console.storeshot.art/billing')}, or use a test key (STORESHOT_ENVIRONMENT=test) to try for free.`,
  UNAUTHORIZED: (_e, source) =>
    source === 'env'
      ? 'The key in STORESHOT_API_KEY is invalid or revoked: create a new one in the console and update the MCP client configuration.'
      : source === 'oauth'
        ? 'This Storeshot connection was disconnected or has expired: reconnect Storeshot in your AI app.'
        : 'The stored key was revoked and has been forgotten: call the tool again to start a new link.',
  FORBIDDEN: (_e, source) =>
    source === 'oauth'
      ? 'This connection lacks a scope this tool needs (see details): reconnect Storeshot in your AI app.'
      : 'The key lacks a scope this tool needs (see details): link again or use a key with that scope.',
  RATE_LIMITED: (e) => `Wait ${e.retryAfterSeconds ?? 60} s, then retry.`,
  CONCURRENCY_LIMITED: () =>
    'Too many jobs are running: wait for them with get_job_status, then retry.',
  INVALID_INPUT: () =>
    'Fix the argument named in details.path; list_devices and get_store_requirements list valid devices.',
  NOT_A_SCREENSHOT: () =>
    'Use a real app screenshot (phone or tablet proportions) for the input named in details.path.',
  UNSUPPORTED_FORMAT: () => 'Use a PNG, JPEG or WebP file.',
  IMAGE_TOO_LARGE: () => 'Use an image of at most 16384 px per side and 50 megapixels.',
  UPLOAD_NOT_READY: () =>
    'Upload the file again with upload_screenshot (uploads last 30 days) and use the new uploadId.',
  SCREENSHOT_SET_STATE_CONFLICT: () =>
    'No image is ready yet: call get_job_status with waitSeconds, then retry.',
  IDEMPOTENCY_CONFLICT: () =>
    'An idempotencyKey can only repeat the same arguments: drop it to create a new job.',
  NOT_FOUND: () => 'Check the id, and pass kind ("generation" or "screenshot_set") if you know it.',
  SERVICE_UNAVAILABLE: () => 'Storeshot is busy: retry a little later.',
  TIMEOUT: (_e, source) =>
    source === 'oauth'
      ? 'The request timed out: retry later.'
      : 'The request timed out: retry later and check STORESHOT_BASE_URL and the network.',
  CONNECTION_ERROR: (_e, source) =>
    source === 'oauth'
      ? 'Storeshot could not be reached: retry later.'
      : 'Storeshot could not be reached: check STORESHOT_BASE_URL and the network.',
  GENERATION_FAILED: () => 'The image failed and was refunded: try again.',
  GENERATION_TIMEOUT: () => 'The image took too long and was refunded: try again.',
  INVALID_CONFIGURATION: () =>
    'Fix the variable named above in the MCP client configuration, then restart the server.',
};

function pick(details: Record<string, unknown> | undefined) {
  if (!details) return undefined;
  const out = Object.fromEntries(Object.entries(details).filter(([k]) => DETAIL_KEYS.includes(k)));
  return Object.keys(out).length ? out : undefined;
}

export function toToolError(error: unknown, ctx: { keySource: KeySource | null }): ToolError {
  if (error instanceof McpToolError) {
    return {
      code: error.code,
      status: null,
      message: error.message,
      requestId: null,
      docUrl: null,
      retryAfterSeconds: null,
      next: error.next,
      details: error.details,
    };
  }
  if (error instanceof StoreshotError) {
    return {
      code: error.code,
      status: error.status || null,
      message: error.message,
      requestId: error.requestId,
      docUrl: error.docUrl,
      retryAfterSeconds: error.retryAfterSeconds,
      next: NEXT[error.code]?.(error, ctx.keySource) ?? 'See the docs URL for this error.',
      details: pick(error.details),
    };
  }
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'INTERNAL_ERROR',
    status: null,
    message: `Unexpected error in storeshot-mcp (${name}): ${message}`.slice(0, 500),
    requestId: null,
    docUrl: null,
    retryAfterSeconds: null,
    next: 'Retry once; if it happens again, report it with the server log (stderr).',
  };
}
