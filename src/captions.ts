import { open, realpath } from 'node:fs/promises';
import { CliError } from './errors.js';

export interface Captions {
  app?: { name: string; description?: string };
  screens: { file: string; caption: string }[];
  featureGraphic?: boolean | { screen: number; caption?: string };
}
/** Spec §8.2: a plain name inside the folder (no separators, no leading dot, ≤ 128). */
export const CAPTION_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/;
const MAX_BYTES = 1024 * 1024;

const bad = (where: string, what: string) =>
  new CliError('USAGE', `captions.json: ${where} ${what}.`, {
    hint: 'See storeshot schema captions for the format.',
  });
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[], where: string) => {
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  if (extra.length) throw bad(where, `has unknown key(s) ${extra.join(', ')}`);
};
const text = (v: unknown, where: string, min: number, max: number) => {
  if (typeof v !== 'string' || v.length < min || v.length > max) {
    throw bad(where, `must be a string of ${min}–${max} characters`);
  }
  return v;
};

/** The same rules as schemas/captions.schema.json (pinned by test/schemas.test.ts). */
export function validateCaptions(value: unknown): Captions {
  if (!isObject(value)) throw bad('the document', 'must be an object');
  onlyKeys(value, ['app', 'screens', 'featureGraphic'], 'the document');
  const out: Captions = { screens: [] };
  if (value.app !== undefined) {
    if (!isObject(value.app)) throw bad('app', 'must be an object');
    onlyKeys(value.app, ['name', 'description'], 'app');
    out.app = { name: text(value.app.name, 'app.name', 1, 100) };
    if (value.app.description !== undefined)
      out.app.description = text(value.app.description, 'app.description', 0, 2000);
  }
  if (!Array.isArray(value.screens) || value.screens.length < 1 || value.screens.length > 10) {
    throw bad('screens', 'must list 1–10 screens');
  }
  value.screens.forEach((s, i) => {
    const where = `screens[${i}]`;
    if (!isObject(s)) throw bad(where, 'must be an object');
    onlyKeys(s, ['file', 'caption'], where);
    const file = text(s.file, `${where}.file`, 1, 128);
    if (!CAPTION_FILE_NAME.test(file))
      throw bad(`${where}.file`, 'must be a plain file name inside the folder');
    out.screens.push({ file, caption: text(s.caption, `${where}.caption`, 1, 1000) });
  });
  const fg = value.featureGraphic;
  if (fg !== undefined) {
    if (typeof fg === 'boolean') out.featureGraphic = fg;
    else if (isObject(fg)) {
      onlyKeys(fg, ['screen', 'caption'], 'featureGraphic');
      if (!Number.isInteger(fg.screen) || (fg.screen as number) < 1 || (fg.screen as number) > 10) {
        throw bad('featureGraphic.screen', 'must be a whole number from 1 to 10');
      }
      out.featureGraphic = { screen: fg.screen as number };
      if (fg.caption !== undefined)
        out.featureGraphic.caption = text(fg.caption, 'featureGraphic.caption', 1, 1000);
    } else throw bad('featureGraphic', 'must be true, false or { screen, caption? }');
  }
  return out;
}

export async function readCaptions(file: string): Promise<Captions> {
  let raw: string;
  try {
    const real = await realpath(file);
    const handle = await open(real, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw bad(file, 'is not a regular file');
      if (info.size > MAX_BYTES) throw bad(file, 'is larger than 1 MiB');
      raw = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('USAGE', `Cannot read the captions file ${file}.`, {
      hint: 'Pass --captions <file>, or put captions.json in the folder (storeshot schema captions).',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw bad(file, 'is not valid JSON');
  }
  return validateCaptions(parsed);
}

/** Shared by this module's test and the schema test (same verdicts). */
export const CAPTION_FIXTURES = {
  valid: [
    { screens: [{ file: 'a.png', caption: 'Hi' }] },
    {
      app: { name: 'Trailmate', description: 'Offline maps' },
      screens: [
        { file: '01-map.png', caption: 'Find' },
        { file: '02.png', caption: 'Go' },
      ],
      featureGraphic: { screen: 1, caption: 'Trailmate' },
    },
    { screens: [{ file: 'a.png', caption: 'x' }], featureGraphic: true },
  ],
  invalid: [
    null,
    [],
    {},
    { screens: [] },
    { screens: Array.from({ length: 11 }, (_, i) => ({ file: `${i}.png`, caption: 'c' })) },
    { screens: [{ file: 'a.png' }] },
    { screens: [{ file: 'a.png', caption: 'c', extra: 1 }] },
    { screens: [{ file: 'a.png', caption: 'c' }], other: 1 },
    { app: {}, screens: [{ file: 'a.png', caption: 'c' }] },
    { screens: [{ file: 'a.png', caption: 'c' }], featureGraphic: { screen: 0 } },
    { screens: [{ file: 'a.png', caption: 'c' }], featureGraphic: 'yes' },
  ],
};
