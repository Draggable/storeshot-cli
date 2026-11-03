import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../.tmp/', import.meta.url));

/** A fresh directory under packages/cli/.tmp/ (git-ignored); callers remove it. */
export function tmpDir(prefix: string): string {
  mkdirSync(ROOT, { recursive: true });
  return mkdtempSync(path.join(ROOT, `${prefix}-`));
}
