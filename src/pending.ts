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
import type { Environment } from './config.js';

/** Spec §7.1: the device code of `login --no-wait`, kept like the key itself (0600 in 0700). */
export interface PendingCode {
  baseUrl: string;
  environment: Environment;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresAt: string;
}
const POSIX = process.platform !== 'win32';

export class PendingStore {
  constructor(
    readonly file: string,
    private readonly warn: (message: string) => void,
  ) {}

  private load(): PendingCode | null {
    let info;
    try {
      info = lstatSync(this.file);
    } catch {
      return null;
    }
    const foreign = typeof process.getuid === 'function' && info.uid !== process.getuid();
    if (!info.isFile() || (POSIX && (info.mode & 0o077 || foreign))) {
      this.warn(`ignoring ${this.file}: readable by other users or not a regular file; delete it`);
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as {
        version: number;
        pending: PendingCode;
      };
      return parsed.version === 1 && parsed.pending ? parsed.pending : null;
    } catch {
      return null;
    }
  }

  /** The pending code of (baseUrl, environment) if it has not expired; an expired one is deleted. */
  read(baseUrl: string, environment: Environment, now: number): PendingCode | null {
    const p = this.load();
    if (!p || p.baseUrl !== baseUrl || p.environment !== environment) return null;
    if (Date.parse(p.expiresAt) <= now) {
      this.clear();
      return null;
    }
    return p;
  }

  write(pending: PendingCode): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (POSIX) chmodSync(dir, 0o700);
    const tmp = path.join(dir, `.cli-device.${randomBytes(6).toString('hex')}.tmp`);
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeSync(fd, `${JSON.stringify({ version: 1, pending }, null, 2)}\n`);
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

  clear(): void {
    rmSync(this.file, { force: true });
  }
}
