import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, realpath, rename, rm, rmdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { McpToolError } from '../errors.js';
import { isInside, resolveUserPath, safeRelativeName } from './paths.js';

export interface WrittenFile {
  path: string;
  relativePath: string;
  bytes: number;
  sha256: string;
}

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const notAllowed = (message: string) =>
  new McpToolError('PATH_NOT_ALLOWED', message, 'Choose an empty folder without symbolic links.');

/** Spec §9.3: preflighted, no-follow, atomic writes below one folder, with rollback. */
export class TreeWriter {
  private createdFiles: string[] = [];
  private createdDirs: string[] = [];

  private constructor(
    readonly folder: string,
    private readonly overwrite: boolean,
  ) {}

  static async open(
    input: string,
    opts: { root: string | null; overwrite: boolean },
  ): Promise<TreeWriter> {
    const absolute = resolveUserPath(input, opts);
    await mkdir(absolute, { recursive: true });
    const real = await realpath(absolute);
    if (opts.root && !isInside(opts.root, real)) {
      throw notAllowed(`${absolute} resolves outside STORESHOT_MCP_ROOT.`);
    }
    return new TreeWriter(real, opts.overwrite);
  }

  /** The target path of `rel`; refuses symlinks and non-folders on the way. */
  private async check(rel: string): Promise<string> {
    const segments = safeRelativeName(rel);
    let current = this.folder;
    for (const [i, segment] of segments.entries()) {
      current = path.join(current, segment);
      const info = await lstat(current).catch(() => null);
      if (!info) continue;
      if (info.isSymbolicLink()) {
        throw notAllowed(`${current} is a symbolic link; downloads never write through links.`);
      }
      const last = i === segments.length - 1;
      if (!last && !info.isDirectory()) throw notAllowed(`${current} is not a folder.`);
      if (last && !info.isFile()) throw notAllowed(`${current} exists and is not a file.`);
    }
    return current;
  }

  /** Checks every target first; with overwrite false, any existing file fails the whole call. */
  async preflight(names: string[]): Promise<void> {
    if (new Set(names).size !== names.length) {
      throw new McpToolError(
        'UNSAFE_ARCHIVE',
        'Duplicate file names from the server.',
        'Report this to support@storeshot.art.',
      );
    }
    const existing: string[] = [];
    for (const name of names) {
      const target = await this.check(name);
      if (!this.overwrite && (await lstat(target).catch(() => null))) existing.push(target);
    }
    if (existing.length) {
      const shown = existing.slice(0, 5).join(', ') + (existing.length > 5 ? ', …' : '');
      throw new McpToolError(
        'FILE_EXISTS',
        `${existing.length} file(s) already exist: ${shown}`,
        'Pass overwrite: true to replace them, or choose another folder.',
        { files: existing },
      );
    }
  }

  async write(rel: string, source: Readable | Uint8Array): Promise<WrittenFile> {
    const target = await this.check(rel);
    let dir = this.folder;
    for (const segment of safeRelativeName(rel).slice(0, -1)) {
      dir = path.join(dir, segment);
      const made = await mkdir(dir).then(
        () => true,
        (e: NodeJS.ErrnoException) => {
          if (e.code !== 'EEXIST') throw e;
          return false;
        },
      );
      if (made) this.createdDirs.push(dir);
      if ((await lstat(dir)).isSymbolicLink()) throw notAllowed(`${dir} is a symbolic link.`);
    }
    const part = path.join(dir, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.part`);
    const hash = createHash('sha256');
    let bytes = 0;
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;
    const handle = await open(part, flags, 0o644);
    try {
      const chunks: AsyncIterable<Uint8Array> | Uint8Array[] =
        source instanceof Uint8Array ? [source] : source;
      for await (const chunk of chunks) {
        hash.update(chunk);
        bytes += chunk.byteLength;
        await handle.write(chunk);
      }
      await handle.sync();
      await handle.close();
      const existed = Boolean(await lstat(target).catch(() => null));
      await rename(part, target);
      if (!existed) this.createdFiles.push(target);
      return { path: target, relativePath: rel, bytes, sha256: hash.digest('hex') };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(part, { force: true });
      throw error;
    }
  }

  /** Removes every file and folder this writer created (replaced files cannot be restored). */
  async rollback(): Promise<void> {
    for (const file of this.createdFiles.reverse()) await rm(file, { force: true });
    for (const dir of this.createdDirs.reverse()) await rmdir(dir).catch(() => undefined);
    this.createdFiles = [];
    this.createdDirs = [];
  }
}
