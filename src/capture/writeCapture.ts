import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../errors.js';
import { TreeWriter, type WrittenFile } from '../shared/mcp.js';

/** The real path of the output folder (created if missing). */
export async function openFolder(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  return realpath(folder);
}

/** Spec §11: checked before any device state changes (TreeWriter.preflight checks again). */
export async function assertFree(folder: string, names: string[], force: boolean): Promise<void> {
  if (force) return;
  const existing: string[] = [];
  for (const name of names) {
    const file = path.join(folder, name);
    if (await lstat(file).catch(() => null)) existing.push(file);
  }
  if (existing.length) {
    throw new CliError(
      'FILE_EXISTS',
      `${existing.length} file(s) already exist: ${existing.join(', ')}`,
      {
        details: { files: existing },
      },
    );
  }
}

/** PNGs first (overwrite only with --force), then captions.json; PNGs roll back on failure. */
export async function writeCapture(
  folder: string,
  files: { name: string; data: Uint8Array }[],
  captions: string | null,
  force: boolean,
): Promise<WrittenFile[]> {
  const pngs = await TreeWriter.open(folder, { root: null, overwrite: force });
  await pngs.preflight(files.map((f) => f.name));
  const written: WrittenFile[] = [];
  try {
    for (const f of files) written.push(await pngs.write(f.name, f.data));
    if (captions !== null) {
      const doc = await TreeWriter.open(folder, { root: null, overwrite: true });
      await doc.write('captions.json', new TextEncoder().encode(captions));
    }
  } catch (error) {
    await pngs.rollback();
    throw error;
  }
  return written;
}
