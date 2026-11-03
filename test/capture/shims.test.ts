import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installShims, type Shims } from './shims/install.mjs';
import { makePng } from './shims/png.mjs';

let shims: Shims | null = null;
afterEach(() => shims?.cleanup());

const ihdr = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe('fake tools (SS-023 spec §16.2)', () => {
  it('makePng writes a valid PNG of the size asked', () => {
    const png = makePng(1206, 2622);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect(ihdr(png)).toEqual([1206, 2622]);
  });
  it('xcrun lists one booted simulator and writes the screenshot file', () => {
    shims = installShims({ png: makePng(1206, 2622) });
    const list = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
      env: shims.env,
    }).toString();
    const sims = Object.values(JSON.parse(list).devices).flat() as { udid: string }[];
    expect(sims).toHaveLength(1);
    const file = path.join(shims.dir, 'shot.png');
    execFileSync('xcrun', ['simctl', 'io', sims[0].udid, 'screenshot', '--type=png', file], {
      env: shims.env,
    });
    expect(ihdr(readFileSync(file))).toEqual([1206, 2622]);
    expect(shims.calls().map((c) => c.argv[1])).toEqual(['list', 'io']);
  });
  it('adb exec-out screencap writes PNG bytes to stdout; the log keeps the whole env', () => {
    shims = installShims({ png: makePng(1080, 2400) });
    const out = execFileSync('adb', ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'], {
      env: { ...shims.env, MARKER: 'x' },
    });
    expect(ihdr(out)).toEqual([1080, 2400]);
    expect(shims.calls()[0].env.MARKER).toBe('x');
  });
  it('maestro writes one PNG per takeScreenshot line under --test-output-dir', () => {
    shims = installShims({ png: makePng(1179, 2556) });
    const flow = path.join(shims.dir, 'flow.yaml');
    writeFileSync(flow, 'appId: x\n---\n- takeScreenshot: 01-map\n- takeScreenshot: 02-off\n');
    const out = path.join(shims.dir, 'maestro-out');
    execFileSync('maestro', ['test', '--test-output-dir', out, flow], { env: shims.env });
    const found = execFileSync('find', [out, '-name', '*.png']).toString().trim().split('\n');
    expect(found.map((f) => path.basename(f)).sort()).toEqual(['01-map.png', '02-off.png']);
  });
});
