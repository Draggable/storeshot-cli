import { ERROR_CODES, SDK_ERROR_CODES, StoreshotError } from '@draggable/storeshot-sdk';
import { McpToolError } from '@storeshot/mcp-src/errors.js';
import { describe, expect, it } from 'vitest';
import { CliError, EXIT, exitCodeOf, toFailure } from '../src/errors.js';

// Spec §12, one group per exit code. Every API, SDK and shared code must appear exactly once.
const TABLE: Record<number, string[]> = {
  1: ['INTERNAL_ERROR', 'WEBHOOK_SIGNATURE_INVALID', 'WEBHOOK_PAYLOAD_INVALID'],
  2: [
    'USAGE',
    'ENVIRONMENT_MISMATCH',
    'INVALID_CONFIGURATION',
    'INVALID_ARGUMENTS',
    'INVALID_INPUT',
    'NOT_A_SCREENSHOT',
    'UNSUPPORTED_FORMAT',
    'IMAGE_TOO_LARGE',
    'PAYLOAD_TOO_LARGE',
    'UPLOAD_NOT_READY',
    'URL_FETCH_FAILED',
    'IDEMPOTENCY_CONFLICT',
    'GENERATION_STATE_CONFLICT',
    'SCREENSHOT_SET_STATE_CONFLICT',
    'WEBHOOK_STATE_CONFLICT',
    'BILLING_STATE_CONFLICT',
    'WEBHOOK_URL_REJECTED',
    'BROWSER_NOT_ALLOWED',
  ],
  3: [
    'NOT_LOGGED_IN',
    'MISSING_API_KEY',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'DEVICE_ACCESS_DENIED',
    'DEVICE_CODE_EXPIRED',
    'DEVICE_INVALID_GRANT',
    'ACCOUNT_LINK_REQUIRED',
    'ACCOUNT_LINK_PENDING',
  ],
  4: ['INSUFFICIENT_CREDITS'],
  5: ['NOT_FOUND'],
  6: ['RATE_LIMITED', 'CONCURRENCY_LIMITED'],
  7: ['SERVICE_UNAVAILABLE', 'BILLING_UNAVAILABLE', 'UNEXPECTED_RESPONSE', 'METHOD_NOT_ALLOWED'],
  8: ['CONNECTION_ERROR', 'TIMEOUT'],
  9: ['PARTIAL_FAILURE', 'GENERATION_FAILED', 'GENERATION_TIMEOUT'],
  10: ['WAIT_TIMEOUT', 'NOT_READY'],
  11: ['CONFIRMATION_REQUIRED', 'SPEND_DECLINED', 'SPEND_LIMIT_EXCEEDED'],
  12: [
    'PATH_NOT_ALLOWED',
    'NOT_A_FILE',
    'FILE_TOO_LARGE',
    'UNSUPPORTED_FILE_TYPE',
    'FILE_EXISTS',
    'UNSAFE_ARCHIVE',
    'DOWNLOAD_TOO_LARGE',
    'NO_RESULT',
    'NODE_ONLY',
  ],
  130: ['INTERRUPTED'],
};

describe('exit codes (spec §12)', () => {
  it('maps every listed code to its documented exit code', () => {
    for (const [exit, codes] of Object.entries(TABLE))
      for (const code of codes)
        expect([code, exitCodeOf(code, null)]).toEqual([code, Number(exit)]);
  });
  it('lists every API and SDK code exactly once', () => {
    const listed = Object.values(TABLE).flat();
    expect(new Set(listed).size).toBe(listed.length);
    for (const code of [...ERROR_CODES, ...SDK_ERROR_CODES]) expect(listed).toContain(code);
  });
  it('falls back by HTTP status for codes added later', () => {
    expect(exitCodeOf('SOMETHING_NEW', 401)).toBe(3);
    expect(exitCodeOf('SOMETHING_NEW', 402)).toBe(4);
    expect(exitCodeOf('SOMETHING_NEW', 404)).toBe(5);
    expect(exitCodeOf('SOMETHING_NEW', 429)).toBe(6);
    expect(exitCodeOf('SOMETHING_NEW', 503)).toBe(7);
    expect(exitCodeOf('SOMETHING_NEW', 422)).toBe(2);
    expect(exitCodeOf('SOMETHING_NEW', null)).toBe(1);
  });
  it('EXIT names the codes', () => {
    expect(EXIT).toMatchObject({
      OK: 0,
      USAGE: 2,
      PARTIAL: 9,
      FILE: 12,
      INTERRUPTED: 130,
      TERMINATED: 143,
    });
  });
});

describe('toFailure', () => {
  it('keeps API error fields and gives a CLI hint', () => {
    const e = new StoreshotError({
      code: 'INSUFFICIENT_CREDITS',
      message: 'Not enough credits.',
      status: 402,
      requestId: 'req_1',
      docUrl: 'https://storeshot.art/docs/errors/#insufficient_credits',
      details: {
        requiredCredits: 4,
        availableCredits: 1,
        topUpUrl: 'https://console.storeshot.art/billing',
        secret: 'x',
      },
    });
    const f = toFailure(e, { keySource: 'env' });
    expect(f).toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      exitCode: 4,
      status: 402,
      requestId: 'req_1',
      details: {
        requiredCredits: 4,
        availableCredits: 1,
        topUpUrl: 'https://console.storeshot.art/billing',
      },
    });
    expect(f.details).not.toHaveProperty('secret');
    expect(f.hint).toContain('--env test');
  });
  it('replaces the MCP next step with CLI wording', () => {
    const f = toFailure(
      new McpToolError('FILE_EXISTS', '2 file(s) already exist: a, b', 'Pass overwrite: true', {
        files: ['a', 'b'],
      }),
      { keySource: null },
    );
    expect(f).toMatchObject({ code: 'FILE_EXISTS', exitCode: 12, details: { files: ['a', 'b'] } });
    expect(f.hint).toContain('--force');
    expect(f.hint).not.toContain('overwrite: true');
  });
  it('UNAUTHORIZED hints depend on where the key came from', () => {
    const e = new StoreshotError({ code: 'UNAUTHORIZED', message: 'no', status: 401 });
    expect(toFailure(e, { keySource: 'stored' }).hint).toContain('storeshot login');
    expect(toFailure(e, { keySource: 'env' }).hint).toContain('console.storeshot.art/keys');
  });
  it('CliError carries data and an explicit exit code (SIGTERM)', () => {
    const f = toFailure(
      new CliError('INTERRUPTED', 'Stopped.', { exitCode: 143, data: { id: 'x' } }),
      { keySource: null },
    );
    expect(f).toMatchObject({ code: 'INTERRUPTED', exitCode: 143, data: { id: 'x' } });
  });
  it('anything else is INTERNAL_ERROR (exit 1)', () => {
    expect(toFailure(new TypeError('boom'), { keySource: null })).toMatchObject({
      code: 'INTERNAL_ERROR',
      exitCode: 1,
    });
  });
});
