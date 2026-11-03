import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { McpToolError } from '../errors.js';
import { safeRelativeName } from './paths.js';

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}
/** A set has at most 50 images + manifest.json (spec §9.3). */
export const ARCHIVE_LIMITS: ZipLimits = {
  maxEntries: 64,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

export interface ZipEntryInfo {
  name: string;
  directory: boolean;
  size: number;
  raw: yauzl.Entry;
}
export interface OpenedZip {
  entries: ZipEntryInfo[];
  open(entry: ZipEntryInfo): Promise<Readable>;
  close(): void;
}

const S_IFMT = 0o170000;
const unsafe = (message: string) =>
  new McpToolError(
    'UNSAFE_ARCHIVE',
    message,
    'Report this to support@storeshot.art with the set id.',
  );

/** Lists and checks every entry (names, types, sizes) before any is read. */
export function openZip(file: string, limits: ZipLimits): Promise<OpenedZip> {
  return new Promise((resolve, reject) => {
    const options = {
      lazyEntries: true,
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
      decodeStrings: true,
    };
    yauzl.open(file, options, (error, zip) => {
      if (error || !zip) {
        reject(unsafe(`The archive cannot be read: ${error?.message ?? 'unknown error'}.`));
        return;
      }
      const entries: ZipEntryInfo[] = [];
      const names = new Set<string>();
      let total = 0;
      let failed = false;
      const fail = (e: Error) => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(e instanceof McpToolError ? e : unsafe(`The archive is invalid: ${e.message}.`));
      };
      zip.on('error', fail);
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          if (entries.length + 1 > limits.maxEntries) {
            throw unsafe(`The archive has more than ${limits.maxEntries} entries.`);
          }
          if (entry.generalPurposeBitFlag & 0x1)
            throw unsafe('The archive has an encrypted entry.');
          const type = (entry.externalFileAttributes >>> 16) & S_IFMT;
          if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
            throw unsafe(`"${entry.fileName}" is not a regular file.`);
          }
          const directory = entry.fileName.endsWith('/');
          const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
          safeRelativeName(name);
          if (names.has(name)) throw unsafe(`"${name}" appears twice.`);
          names.add(name);
          if (entry.uncompressedSize > limits.maxEntryBytes) {
            throw unsafe(`"${name}" is larger than ${limits.maxEntryBytes} bytes.`);
          }
          total += entry.uncompressedSize;
          if (total > limits.maxTotalBytes) {
            throw unsafe(`The archive is larger than ${limits.maxTotalBytes} bytes.`);
          }
          entries.push({ name, directory, size: entry.uncompressedSize, raw: entry });
          zip.readEntry();
        } catch (e) {
          fail(e as Error);
        }
      });
      zip.on('end', () => {
        if (failed) return;
        resolve({
          entries,
          open: (entry) =>
            new Promise((ok, ko) =>
              zip.openReadStream(entry.raw, (e, stream) =>
                e || !stream ? ko(e ?? new Error('no stream')) : ok(stream),
              ),
            ),
          close: () => zip.close(),
        });
      });
      zip.readEntry();
    });
  });
}
