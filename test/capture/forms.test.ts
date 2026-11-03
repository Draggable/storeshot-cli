import { describe, expect, it } from 'vitest';
import type { FlagValue, Parsed } from '../../src/args.js';
import { GLOBAL_FLAGS } from '../../src/args.js';
import {
  checkFormFlags,
  checkUrl,
  fileNameOf,
  parseForm,
  resolveRoute,
  SERIAL,
  UDID,
} from '../../src/capture/forms.js';

const globals = Object.keys(GLOBAL_FLAGS);
/** What parseCli returns for `storeshot capture <positionals> <flags>` (flags already typed). */
const parsed = (positionals: string[], flags: Record<string, FlagValue> = {}): Parsed => ({
  command: 'capture' as Parsed['command'],
  positionals,
  flags,
  help: false,
  version: false,
  bare: false,
});
const check = (positionals: string[], flags: Record<string, FlagValue> = {}) => {
  const p = parsed(positionals, flags);
  const form = parseForm(p);
  checkFormFlags(p, form, globals);
  return form;
};
const err = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('capture forms (spec §3)', () => {
  it('forms and positionals', () => {
    expect(check(['ios'])).toBe('ios');
    expect(check(['web', 'http://localhost:8081'])).toBe('web');
    expect(err(() => check(['tvos']))).toMatch(/Unknown capture form "tvos"/);
    expect(err(() => check(['web']))).toMatch(/Usage: storeshot capture web <url>/);
    expect(err(() => check(['ios', 'extra']))).toMatch(/no other arguments/);
  });
  it('per-form flags', () => {
    expect(err(() => check(['android'], { udid: 'x' }))).toBe(
      '--udid applies to capture ios only.',
    );
    expect(err(() => check(['ios'], { route: ['/'] }))).toBe(
      '--route applies to capture web only.',
    );
    expect(err(() => check(['web', 'http://h'], { 'clean-status-bar': true }))).toBe(
      '--clean-status-bar applies to capture ios/android only.',
    );
    expect(err(() => check(['ios'], { 'reset-status-bar': true, name: 'a' }))).toMatch(
      /--reset-status-bar only takes/,
    );
    expect(check(['ios'], { 'reset-status-bar': true, json: true })).toBe('ios');
    expect(err(() => check(['web', 'http://h'], { route: ['/'], pages: 'p.json' }))).toBe(
      'Pass --route or --pages, not both.',
    );
    expect(err(() => check(['ios'], { 'no-captions': true, 'app-name': 'X' }))).toMatch(
      /--app-name writes captions.json/,
    );
  });
  it('flag values', () => {
    expect(err(() => check(['ios'], { udid: 'booted' }))).toMatch(
      /--udid must be a simulator UDID/,
    );
    expect(err(() => check(['android'], { serial: '-rf' }))).toMatch(/--serial/);
    expect(err(() => check(['web', 'http://h'], { locale: 'en_US' }))).toMatch(/--locale/);
    expect(err(() => check(['web', 'http://h'], { 'wait-until': 'idle' }))).toMatch(/--wait-until/);
    expect(err(() => check(['web', 'http://h'], { 'color-scheme': 'blue' }))).toMatch(
      /--color-scheme/,
    );
    expect(err(() => check(['web', 'http://h'], { orientation: 'up' }))).toMatch(/--orientation/);
    expect(err(() => check(['ios'], { caption: '' }))).toMatch(/--caption/);
  });
  it('UDID and serial patterns refuse option-like and shell-like values', () => {
    for (const bad of ['-rf', '--foo', 'a b', '$(x)', 'a;b', 'a\u0000b', '', '..'])
      expect(SERIAL.test(bad), JSON.stringify(bad)).toBe(false);
    for (const ok of ['emulator-5554', '203.0.113.5:5555', 'adb-R58M._adb-tls-connect._tcp'])
      expect(SERIAL.test(ok), ok).toBe(true);
    expect(UDID.test('AAAAAAAA-1111-4111-8111-111111111111')).toBe(true);
    expect(UDID.test('booted')).toBe(false);
  });
  it('names', () => {
    expect(fileNameOf('01-map')).toBe('01-map.png');
    expect(fileNameOf('01-map.PNG')).toBe('01-map.png');
    for (const bad of ['../x', '.hidden', 'a/b', 'a b', '-x', ''])
      expect(
        err(() => fileNameOf(bad)),
        bad,
      ).toMatch(/--name/);
  });
  it('URLs and routes', () => {
    expect(checkUrl('http://localhost:8081').origin).toBe('http://localhost:8081');
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://u:p@h/',
      'nope',
      'data:,x',
    ])
      expect(
        err(() => checkUrl(bad)),
        bad,
      ).not.toBe('ok');
    const base = new URL('http://localhost:8081/app/');
    expect(resolveRoute(base, '/settings')).toBe('http://localhost:8081/settings');
    expect(resolveRoute(base, '/#/settings')).toBe('http://localhost:8081/#/settings');
    for (const bad of ['settings', '//evil.example/x', '/\\evil.example', '/a\u0000'])
      expect(
        err(() => resolveRoute(base, bad)),
        bad,
      ).not.toBe('ok');
  });
});
