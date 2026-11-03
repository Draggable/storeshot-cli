import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Smallest bytes that pass the magic-byte check (the server is faked in unit tests). */
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

export function writeShots(dir: string, names: string[], captions?: unknown): void {
  mkdirSync(dir, { recursive: true });
  for (const n of names) writeFileSync(path.join(dir, n), PNG);
  if (captions !== undefined)
    writeFileSync(path.join(dir, 'captions.json'), JSON.stringify(captions));
}
