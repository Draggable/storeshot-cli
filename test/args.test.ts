import { describe, expect, it } from 'vitest';
import { COMMANDS, GLOBAL_FLAGS, helpText, parseCli } from '../src/args.js';

const usage = (argv: string[]) => {
  try {
    parseCli(argv);
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'ok';
};

describe('parseCli', () => {
  it('top level: bare, --help, --version', () => {
    expect(parseCli([])).toMatchObject({ command: null, help: true, bare: true });
    expect(parseCli(['--help'])).toMatchObject({ command: null, help: true, bare: false });
    expect(parseCli(['--version'])).toMatchObject({ version: true });
  });
  it('unknown command or option is USAGE', () => {
    expect(usage(['frobnicate'])).toBe('USAGE');
    expect(usage(['--json'])).toBe('USAGE');
    expect(usage(['credits', '--bogus'])).toBe('USAGE');
  });
  it('lists split on commas and repeat', () => {
    const p = parseCli([
      'set',
      'shots',
      '--store',
      'app_store',
      '--store',
      'google_play',
      '--devices',
      'a, b,,c',
    ]);
    expect(p.flags.store).toEqual(['app_store', 'google_play']);
    expect(p.flags.devices).toEqual(['a', 'b', 'c']);
    expect(p.positionals).toEqual(['shots']);
  });
  it('integers are checked against their range', () => {
    expect(parseCli(['status', 'x', '--timeout', '30']).flags.timeout).toBe(30);
    expect(usage(['status', 'x', '--timeout', '0'])).toBe('USAGE');
    expect(usage(['status', 'x', '--timeout', '3601'])).toBe('USAGE');
    expect(usage(['set', 'd', '--max-credits', '-1'])).toBe('USAGE');
    expect(parseCli(['set', 'd', '--max-credits', '0']).flags['max-credits']).toBe(0);
  });
  it('positional counts', () => {
    expect(usage(['status'])).toBe('USAGE');
    expect(usage(['status', 'a', 'b'])).toBe('USAGE');
    expect(usage(['generate'])).toBe('USAGE');
    expect(parseCli(['generate', 'a.png', 'b.png']).positionals).toEqual(['a.png', 'b.png']);
    expect(usage(['credits', 'extra'])).toBe('USAGE');
  });
  it('global flags on every command; -h works', () => {
    for (const name of Object.keys(COMMANDS)) {
      const p = parseCli([name, '-h']);
      expect(p.help).toBe(true);
    }
    expect(parseCli(['credits', '--json', '--env', 'live']).flags).toMatchObject({
      json: true,
      env: 'live',
    });
  });
});

describe('helpText', () => {
  it('names every command at the top level and every flag per command', () => {
    const top = helpText(null);
    for (const name of Object.keys(COMMANDS)) expect(top).toContain(name);
    expect(top).toContain('npx @draggable/storeshot-cli');
    expect(top).not.toMatch(/npx\s+(?:-y\s+)?storeshot(?![-\w/@])/);
    for (const [name, spec] of Object.entries(COMMANDS)) {
      const text = helpText(name as keyof typeof COMMANDS);
      for (const flag of [...Object.keys(spec.flags), ...Object.keys(GLOBAL_FLAGS)])
        expect(text).toContain(`--${flag}`);
    }
  });
  it('documents the exit codes', () => {
    expect(helpText(null)).toMatch(/Exit codes:[\s\S]*12 /);
  });
});
