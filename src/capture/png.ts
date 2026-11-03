import { CliError } from '../errors.js';
import { sniff } from '../shared/mcp.js';
import { screenshotVerdict } from './screenshotRules.js';

export interface PngInfo {
  width: number;
  height: number;
}
/** The upload limits of the contract (createUpload): 20 MiB, 50 MP, 16384 px per side. */
export const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;
export const MAX_EDGE = 16384;
export const MAX_PIXELS = 50_000_000;

/** PNG signature (MCP sniff) and an IHDR chunk first; null otherwise. No decoding (spec §6.3). */
export function pngInfo(bytes: Uint8Array): PngInfo | null {
  if (bytes.length < 24 || sniff(bytes.subarray(0, 16)) !== 'image/png') return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Spec §6.4: what the API would accept as a raw screenshot, checked before any write. */
export function checkCapture(bytes: Uint8Array, source: string): PngInfo {
  const info = pngInfo(bytes);
  if (!info) throw new CliError('CAPTURE_FAILED', `${source} did not return a PNG image.`);
  if (bytes.byteLength > MAX_CAPTURE_BYTES) {
    throw new CliError(
      'FILE_TOO_LARGE',
      `The capture is ${bytes.byteLength} bytes; uploads are at most 20 MiB.`,
    );
  }
  if (Math.max(info.width, info.height) > MAX_EDGE || info.width * info.height > MAX_PIXELS) {
    throw new CliError(
      'IMAGE_TOO_LARGE',
      `The capture (${info.width}x${info.height}) is above 16384 px per side or 50 megapixels.`,
    );
  }
  const verdict = screenshotVerdict(info);
  if (!verdict.ok) throw new CliError('NOT_A_SCREENSHOT', verdict.message);
  return info;
}
