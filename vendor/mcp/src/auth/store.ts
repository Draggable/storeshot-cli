import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import type { Environment } from '../config.js';
import type { Logger } from '../stdout.js';

export interface StoredKey {
  baseUrl: string;
  environment: Environment;
  apiKey: string;
  keyId: string;
  scopes: string[];
  createdAt: string;
}
interface FileShape {
  version: 1;
  keys: StoredKey[];
}

const POSIX = process.platform !== 'win32';

/**
 * Spec §6.1: `${XDG_CONFIG_HOME:-~/.config}/storeshot/mcp-credentials.json`, 0600 in a 0700
 * folder, one key per (base URL, environment of the key).
 */
export class CredentialStore {
  constructor(
    readonly file: string,
    private readonly warn: Logger,
  ) {}

  /** The parsed file; an empty one when missing; null when it must not be used. */
  private load(): FileShape | null {
    let info;
    try {
      info = lstatSync(this.file);
    } catch {
      return { version: 1, keys: [] };
    }
    if (!info.isFile()) {
      this.warn(`ignoring ${this.file}: not a regular file`);
      return null;
    }
    const foreign = typeof process.getuid === 'function' && info.uid !== process.getuid();
    if (POSIX && (info.mode & 0o077 || foreign)) {
      this.warn(
        `ignoring ${this.file}: readable by other users; fix it with "chmod 600 ${this.file}" or delete it`,
      );
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as FileShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.keys)) throw new Error('unknown version');
      return parsed;
    } catch {
      this.warn(`ignoring ${this.file}: not a valid credentials file (delete it to start over)`);
      return null;
    }
  }

  /**
   * Amendment A2: with an environment, the entry of that environment only; without one, the most
   * recently created entry for the base URL.
   */
  read(baseUrl: string, environment: Environment | null): StoredKey | null {
    const keys = (this.load()?.keys ?? []).filter(
      (k) => k.baseUrl === baseUrl && (environment === null || k.environment === environment),
    );
    return keys.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  private save(keys: StoredKey[]): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (POSIX) chmodSync(dir, 0o700);
    const tmp = path.join(dir, `.mcp-credentials.${randomBytes(6).toString('hex')}.tmp`);
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeSync(fd, `${JSON.stringify({ version: 1, keys }, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, this.file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }

  write(entry: StoredKey): void {
    const same = (k: StoredKey) =>
      k.baseUrl === entry.baseUrl && k.environment === entry.environment;
    this.save([...(this.load()?.keys ?? []).filter((k) => !same(k)), entry]);
  }

  remove(baseUrl: string, environment: Environment): void {
    const current = this.load();
    if (!current) return;
    this.save(
      current.keys.filter((k) => !(k.baseUrl === baseUrl && k.environment === environment)),
    );
  }
}
