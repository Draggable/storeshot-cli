import { open, realpath } from 'node:fs/promises';
import { CliError } from '../errors.js';
import { NAME } from './forms.js';

export interface PageSpec {
  path: string;
  name?: string;
  caption?: string;
  waitFor?: string;
  delayMs?: number;
}
const MAX_BYTES = 1024 * 1024;
const KEYS = ['path', 'name', 'caption', 'waitFor', 'delayMs'];
const bad = (where: string, what: string) =>
  new CliError('USAGE', `pages.json: ${where} ${what}.`, {
    hint: 'See storeshot schema capture-pages for the format.',
  });
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, where: string, min: number, max: number) => {
  if (typeof v !== 'string' || v.length < min || v.length > max)
    throw bad(where, `must be a string of ${min}–${max} characters`);
  return v;
};

/** The same rules as schemas/capture-pages.schema.json (pinned by test/schemas.test.ts). */
export function validatePages(value: unknown): PageSpec[] {
  if (!isObject(value)) throw bad('the document', 'must be an object');
  const extra = Object.keys(value).filter((k) => k !== 'pages');
  if (extra.length) throw bad('the document', `has unknown key(s) ${extra.join(', ')}`);
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 10)
    throw bad('pages', 'must list 1–10 pages');
  return value.pages.map((p, i) => {
    const where = `pages[${i}]`;
    if (!isObject(p)) throw bad(where, 'must be an object');
    const unknown = Object.keys(p).filter((k) => !KEYS.includes(k));
    if (unknown.length) throw bad(where, `has unknown key(s) ${unknown.join(', ')}`);
    const out: PageSpec = { path: text(p.path, `${where}.path`, 1, 2000) };
    if (!out.path.startsWith('/')) throw bad(`${where}.path`, 'must start with /');
    if (p.name !== undefined) {
      out.name = text(p.name, `${where}.name`, 1, 100);
      if (!NAME.test(out.name))
        throw bad(`${where}.name`, 'must be letters, digits, ".", "_" or "-"');
    }
    if (p.caption !== undefined) out.caption = text(p.caption, `${where}.caption`, 1, 1000);
    if (p.waitFor !== undefined) out.waitFor = text(p.waitFor, `${where}.waitFor`, 1, 500);
    if (p.delayMs !== undefined) {
      if (
        !Number.isInteger(p.delayMs) ||
        (p.delayMs as number) < 0 ||
        (p.delayMs as number) > 30_000
      )
        throw bad(`${where}.delayMs`, 'must be a whole number from 0 to 30000');
      out.delayMs = p.delayMs as number;
    }
    return out;
  });
}

export async function readPagesFile(file: string): Promise<PageSpec[]> {
  let raw: string;
  try {
    const handle = await open(await realpath(file), 'r');
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
    throw new CliError('USAGE', `Cannot read the pages file ${file}.`, {
      hint: 'Pass --pages <file> (storeshot schema capture-pages).',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw bad(file, 'is not valid JSON');
  }
  return validatePages(parsed);
}

/** Shared by this module's test and the schema test (same verdicts). */
export const PAGES_FIXTURES = {
  valid: [
    { pages: [{ path: '/' }] },
    {
      pages: [
        { path: '/', name: '01-map', caption: 'Find every trail', waitFor: '[data-testid="map"]' },
        { path: '/#/offline', caption: 'Works offline', delayMs: 1000 },
      ],
    },
  ],
  invalid: [
    null,
    [],
    {},
    { pages: [] },
    { pages: Array.from({ length: 11 }, () => ({ path: '/' })) },
    { pages: [{}] },
    { pages: [{ path: 'settings' }] },
    { pages: [{ path: '/', name: '../x' }] },
    { pages: [{ path: '/', caption: '' }] },
    { pages: [{ path: '/', delayMs: -1 }] },
    { pages: [{ path: '/', delayMs: 1.5 }] },
    { pages: [{ path: '/', extra: 1 }] },
    { pages: [{ path: '/' }], other: 1 },
  ],
};
