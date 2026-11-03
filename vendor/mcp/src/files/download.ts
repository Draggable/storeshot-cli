import { constants } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { McpToolError } from '../errors.js';

export const MAX_RESULT_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

const tooLarge = (max: number) =>
  new McpToolError(
    'DOWNLOAD_TOO_LARGE',
    `The download is larger than ${max} bytes.`,
    'Report this to support@storeshot.art with the job id.',
  );

export const isLoopbackUrl = (value: string): boolean => LOOPBACK.test(new URL(value).hostname);

/** AbortSignal.any for Node 18 (it arrived in Node 20.3). */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/** A signed result URL: https (http only on loopback when allowed), no credentials, no redirects. */
export async function fetchSignedUrl(
  value: string,
  opts: { allowLoopbackHttp: boolean; maxBytes: number; signal?: AbortSignal },
): Promise<Uint8Array> {
  const url = new URL(value);
  const plainLocal =
    url.protocol === 'http:' && LOOPBACK.test(url.hostname) && opts.allowLoopbackHttp;
  if (url.protocol !== 'https:' && !plainLocal) throw new Error('Result URLs must use https.');
  const timeout = AbortSignal.timeout(60_000);
  const signal = anySignal(opts.signal ? [opts.signal, timeout] : [timeout]);
  const response = await fetch(url, { redirect: 'error', signal });
  if (!response.ok) throw new Error(`The result download answered HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length') ?? 0) > opts.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(opts.maxBytes);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > opts.maxBytes) throw tooLarge(opts.maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Streams `body` to `file` (created exclusively, 0600) and deletes it when over `maxBytes`. */
export async function saveStreamCapped(
  body: ReadableStream<Uint8Array>,
  file: string,
  maxBytes: number,
): Promise<number> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;
  const handle = await open(file, flags, 0o600);
  let total = 0;
  try {
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > maxBytes) throw tooLarge(maxBytes);
      await handle.write(chunk);
    }
    await handle.close();
    return total;
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(file, { force: true });
    throw error;
  }
}
