import { describe, expect, it } from 'vitest';
import { Output, envelope, stripControl } from '../src/output.js';
import { captured } from './helpers/streams.js';

const KEY = 'ss_test_' + 'k'.repeat(32);
const make = (
  o: Partial<{ json: boolean; quiet: boolean; noColor: boolean; env: Record<string, string> }> = {},
  tty = false,
) => {
  const c = captured({ stderrTTY: tty });
  const out = new Output(c.streams, { json: false, quiet: false, noColor: false, env: {}, ...o });
  return { c, out };
};

describe('Output', () => {
  it('--json writes exactly one JSON document and nothing else on stdout', () => {
    const { c, out } = make({ json: true });
    out.notice('uploading home.png');
    out.progress('Set x: 1/4', 'running 1/4');
    out.result(envelope('credits', 0, { total: 4 }, null, []), ['ignored']);
    const lines = c.stdout().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      schemaVersion: 1,
      command: 'credits',
      ok: true,
      exitCode: 0,
      data: { total: 4 },
      error: null,
    });
    expect(c.stderr()).toContain('uploading home.png');
  });
  it('refuses a second result', () => {
    const { out } = make();
    out.result(envelope('whoami', 0, null, null, []), []);
    expect(() => out.result(envelope('whoami', 0, null, null, []), [])).toThrow();
  });
  it('scrubs every known secret on stdout and stderr', () => {
    const { c, out } = make({ json: true });
    out.addSecret(KEY);
    out.notice(`using ${KEY}`);
    out.result(envelope('whoami', 0, { echo: KEY }, null, []), []);
    expect(c.stdout() + c.stderr()).not.toContain(KEY);
    expect(c.stderr()).toContain(`${KEY.slice(0, 8)}…`);
  });
  it('masks only real secret shapes, never ordinary words (PM M5)', () => {
    const { c, out } = make();
    const live = 'ss_live_' + 'Q'.repeat(40);
    const bearer = 'Bearer ' + 'tok.EN-' + 'x'.repeat(30);
    out.addSecret('short');
    out.addSecret('D'.repeat(43));
    out.notice(`key ${live} and ${bearer} and device ${'D'.repeat(43)}`);
    const words =
      'code=rate_limited state="pending" device_code error_description authorization_pending code BCDF-GHJK ss_test_short';
    out.notice(words);
    out.notice('Invalid "state" or "code": the request failed (token expired).');
    const err = c.stderr();
    expect(err).not.toContain(live);
    expect(err).toContain('ss_live_…');
    expect(err).toContain('Bearer …');
    expect(err).not.toContain('D'.repeat(43));
    expect(err).toContain(`${words}\n`);
    expect(err).toContain('Invalid "state" or "code": the request failed (token expired).');
    expect(out.secrets).not.toContain('short');
  });
  it('strips control characters from human output (terminal escape injection)', () => {
    const { c, out } = make();
    out.result(envelope('status', 0, null, null, []), ['caption: \u001b]0;pwned\u0007Hi\u009b2J']);
    expect(c.stdout()).toBe('caption: ]0;pwnedHi2J\n');
    expect(stripControl('a\nb\tc')).toBe('a\nbc');
  });
  it('colour only on a TTY stderr without NO_COLOR, TERM=dumb, --no-color or --json', () => {
    expect(make({}, true).out.colour).toBe(true);
    expect(make({}, false).out.colour).toBe(false);
    expect(make({ env: { NO_COLOR: '1' } }, true).out.colour).toBe(false);
    expect(make({ env: { TERM: 'dumb' } }, true).out.colour).toBe(false);
    expect(make({ noColor: true }, true).out.colour).toBe(false);
    expect(make({ json: true }, true).out.colour).toBe(false);
    const { c, out } = make({}, false);
    out.warn('deprecated device');
    expect(c.stderr()).toBe('warning: deprecated device\n');
    expect(out.warnings).toEqual(['deprecated device']);
  });
  it('non-TTY progress prints one line per change of key, no \\r', () => {
    const { c, out } = make();
    out.progress('Set x: running 0/4 (1 s)', 'running 0/4');
    out.progress('Set x: running 0/4 (2 s)', 'running 0/4');
    out.progress('Set x: running 2/4 (5 s)', 'running 2/4');
    expect(c.stderr()).toBe('Set x: running 0/4 (1 s)\nSet x: running 2/4 (5 s)\n');
  });
  it('TTY progress redraws one line and clears it before the result', () => {
    const { c, out } = make({}, true);
    out.progress('waiting (1 s)', 'w');
    out.result(envelope('status', 0, null, null, []), ['done']);
    expect(c.stderr()).toMatch(/\r\u001b\[2K(\u001b\[2m)?waiting \(1 s\)/);
    expect(c.stderr().endsWith('\r\u001b[2K')).toBe(true);
  });
  it('--quiet hides notices and progress but not warnings or errors', () => {
    const { c, out } = make({ quiet: true });
    out.notice('n');
    out.progress('p');
    out.warn('w');
    out.errorLine('e');
    expect(c.stderr()).toBe('warning: w\nerror: e\n');
  });
});

describe('envelope', () => {
  it('a failure becomes the error object and ok false', () => {
    const doc = envelope(
      'pull',
      12,
      null,
      {
        code: 'FILE_EXISTS',
        message: 'm',
        hint: 'h',
        status: null,
        requestId: null,
        docUrl: null,
        retryAfterSeconds: null,
        details: { files: ['a'] },
        exitCode: 12,
      },
      ['w'],
    );
    expect(doc).toEqual({
      schemaVersion: 1,
      command: 'pull',
      ok: false,
      exitCode: 12,
      data: null,
      warnings: ['w'],
      error: {
        code: 'FILE_EXISTS',
        message: 'm',
        hint: 'h',
        status: null,
        requestId: null,
        docUrl: null,
        retryAfterSeconds: null,
        details: { files: ['a'] },
      },
    });
  });
});
