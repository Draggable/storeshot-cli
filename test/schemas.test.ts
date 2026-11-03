import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/args.js';
import { CAPTION_FIXTURES, validateCaptions } from '../src/captions.js';
import { SCHEMAS, schemaFileName } from '../src/jsonSchemas.js';

const DIR = fileURLToPath(new URL('../schemas/', import.meta.url));
const UPDATE = process.env.UPDATE_SCHEMAS === '1';
const ajv = () => new Ajv2020({ strict: true, allErrors: true });

describe('schemas/ (spec §11.2)', () => {
  it('the committed files equal src/jsonSchemas.ts (UPDATE_SCHEMAS=1 rewrites them)', () => {
    if (UPDATE) mkdirSync(DIR, { recursive: true });
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      const file = path.join(DIR, schemaFileName(name));
      const text = `${JSON.stringify(schema, null, 2)}\n`;
      if (UPDATE) writeFileSync(file, text);
      expect(readFileSync(file, 'utf8'), file).toBe(text);
    }
    expect(readdirSync(DIR).sort()).toEqual(Object.keys(SCHEMAS).map(schemaFileName).sort());
  });
  it('every schema compiles under Ajv 2020 strict mode', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      if (name === 'index') continue;
      expect(() => ajv().compile(schema), name).not.toThrow();
    }
  });
  it('index lists every command and schemaVersion 1', () => {
    expect(SCHEMAS.index).toMatchObject({ schemaVersion: 1 });
    for (const name of Object.keys(COMMANDS).filter((c) => c !== 'schema'))
      expect((SCHEMAS.index as { commands: Record<string, string> }).commands[name]).toBe(
        `${name}.schema.json`,
      );
  });
  it('captions.schema.json and validateCaptions agree on every fixture', () => {
    const check = ajv().compile(SCHEMAS.captions);
    const runtime = (v: unknown) => {
      try {
        validateCaptions(v);
        return true;
      } catch {
        return false;
      }
    };
    for (const v of [...CAPTION_FIXTURES.valid, ...CAPTION_FIXTURES.invalid])
      expect([JSON.stringify(v), check(v)]).toEqual([JSON.stringify(v), runtime(v)]);
  });
  it('capture-pages.schema.json and validatePages agree on every fixture', async () => {
    const { PAGES_FIXTURES, validatePages } = await import('../src/capture/pages.js');
    const check = ajv().compile(SCHEMAS['capture-pages']);
    const runtime = (v: unknown) => {
      try {
        validatePages(v);
        return true;
      } catch {
        return false;
      }
    };
    for (const v of [...PAGES_FIXTURES.valid, ...PAGES_FIXTURES.invalid])
      expect([JSON.stringify(v), check(v)]).toEqual([JSON.stringify(v), runtime(v)]);
  });
  it('index names the capture schemas', () => {
    expect(SCHEMAS.index).toMatchObject({
      capturePages: 'capture-pages.schema.json',
      commands: { capture: 'capture.schema.json' },
    });
  });
});
