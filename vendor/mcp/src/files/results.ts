import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { json } from 'node:stream/consumers';
import type { Generation, Storeshot } from '@draggable/storeshot-sdk';
import { McpToolError } from '../errors.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_RESULT_BYTES,
  fetchSignedUrl,
  saveStreamCapped,
} from './download.js';
import { ARCHIVE_LIMITS, openZip } from './unzip.js';
import type { TreeWriter, WrittenFile } from './writeTree.js';

/**
 * Spec §9.3: a generation's image or a set's archive → files below one TreeWriter folder. Shared
 * by download_results and the Storeshot CLI (no zod, no MCP SDK).
 */
export type StoreName = 'app_store' | 'google_play';
export type ArchiveLayout = 'store' | 'fastlane';
export interface SavedFile extends WrittenFile {
  store: StoreName | null;
  device: string | null;
  position: number | null;
}
export interface MissingImage {
  store: StoreName | null;
  device: string | null;
  position: number | null;
  status: string;
  errorCode: string | null;
}
export interface SavedResults {
  files: SavedFile[];
  complete: boolean;
  missing: MissingImage[];
  imageUrls: string[];
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_MANIFEST_BYTES = 1024 * 1024;
interface Manifest {
  files?: { path: string; store?: string; device?: string; position?: number }[];
  missing?: {
    store?: string;
    device?: string;
    position?: number;
    status: string;
    errorCode?: string | null;
  }[];
  complete?: boolean;
}
const asStore = (value: string | undefined): StoreName | null =>
  value === 'app_store' || value === 'google_play' ? value : null;
const unsafe = (message: string) =>
  new McpToolError('UNSAFE_ARCHIVE', message, 'Report this to support@storeshot.art.');

/** The image of a succeeded generation as `<name ?? id>.<ext>`. */
export async function saveGenerationResult(
  g: Generation,
  writer: TreeWriter,
  opts: { name?: string; allowLoopbackHttp: boolean; signal?: AbortSignal },
): Promise<SavedResults> {
  if (!g.result) {
    throw new McpToolError(
      'NO_RESULT',
      `Generation ${g.id} has no result (${g.status}).`,
      'Wait with get_job_status until it succeeded.',
    );
  }
  const ext = EXT[g.result.image.contentType];
  if (!ext) throw unsafe(`Unexpected content type ${g.result.image.contentType}.`);
  const name = `${opts.name ?? g.id}.${ext}`;
  await writer.preflight([name]);
  const bytes = await fetchSignedUrl(g.result.image.url, {
    allowLoopbackHttp: opts.allowLoopbackHttp,
    maxBytes: MAX_RESULT_BYTES,
    signal: opts.signal,
  });
  const file = await writer.write(name, bytes);
  return {
    files: [
      { ...file, store: g.store, device: g.device, position: g.screenshotSet?.position ?? null },
    ],
    complete: true,
    missing: [],
    imageUrls: [g.result.image.url],
  };
}

/** A set's archive (`layout`), extracted below the writer's folder; manifest.json is not written. */
export async function saveSetArchive(
  client: Storeshot,
  id: string,
  writer: TreeWriter,
  opts: { layout: ArchiveLayout; signal?: AbortSignal },
): Promise<SavedResults> {
  const temp = path.join(writer.folder, `.storeshot-${randomBytes(6).toString('hex')}.zip.part`);
  try {
    const stream = await client.screenshotSets.archiveStream(id, {
      layout: opts.layout,
      signal: opts.signal,
    });
    await saveStreamCapped(stream, temp, MAX_ARCHIVE_BYTES);
    const zip = await openZip(temp, ARCHIVE_LIMITS);
    try {
      const manifestEntry = zip.entries.find((e) => e.name === 'manifest.json');
      const entries = zip.entries.filter((e) => !e.directory && e !== manifestEntry);
      if (manifestEntry && manifestEntry.size > MAX_MANIFEST_BYTES) {
        throw unsafe('manifest.json is too large.');
      }
      const manifest = (manifestEntry ? await json(await zip.open(manifestEntry)) : {}) as Manifest;
      await writer.preflight(entries.map((e) => e.name));
      const written: WrittenFile[] = [];
      for (const entry of entries)
        written.push(await writer.write(entry.name, await zip.open(entry)));
      const meta = new Map((manifest.files ?? []).map((f) => [f.path, f]));
      const files = written.map((f) => {
        const m = meta.get(f.relativePath);
        return {
          ...f,
          store: asStore(m?.store),
          device: m?.device ?? null,
          position: m?.position ?? null,
        };
      });
      const missing = (manifest.missing ?? []).map((m) => ({
        store: asStore(m.store),
        device: m.device ?? null,
        position: m.position ?? null,
        status: m.status,
        errorCode: m.errorCode ?? null,
      }));
      const complete = manifest.complete ?? missing.length === 0;
      return { files, complete, missing, imageUrls: [] };
    } finally {
      zip.close();
    }
  } finally {
    await rm(temp, { force: true });
  }
}
