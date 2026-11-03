import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { candidates, childEnv, findTool, runTool, type Tool } from '../../src/capture/tools.js';
import { tmpDir } from '../helpers/tmp.js';

const dir = tmpDir('tools');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const bin = path.join(dir, 'bin');
mkdirSync(bin);
writeFileSync(path.join(bin, 'adb'), '#!/bin/sh\necho hi\n');
chmodSync(path.join(bin, 'adb'), 0o755);
writeFileSync(path.join(bin, 'xcrun'), 'not executable');
chmodSync(path.join(bin, 'xcrun'), 0o644);
const node: Tool = { name: 'node', path: process.execPath };
const base = { env: childEnv(process.env), cwd: dir, label: 'node' };

describe('tools (spec §5)', () => {
  it('findTool: absolute PATH entries only, executables only', () => {
    const warns: string[] = [];
    expect(findTool('adb', { PATH: `.:bin:${bin}` }, { warn: (m) => warns.push(m) })).toEqual({
      name: 'adb',
      path: path.join(bin, 'adb'),
    });
    expect(warns).toEqual(['Ignoring relative PATH entries: ., bin.']);
    expect(findTool('xcrun', { PATH: bin })).toBeNull();
    expect(findTool('adb', { PATH: '' })).toBeNull();
    expect(findTool('adb', {})).toBeNull();
  });
  it('candidates: Windows never runs .cmd or .bat (they need a shell)', () => {
    expect(candidates('adb', 'win32')).toEqual(['adb.exe', 'adb.com']);
    expect(candidates('adb', 'darwin')).toEqual(['adb']);
  });
  it('childEnv strips STORESHOT_* in any case and drops undefined values', () => {
    expect(
      childEnv({
        PATH: '/x',
        STORESHOT_API_KEY: 'k',
        storeshot_base_url: 'u',
        HOME: undefined,
        ANDROID_SERIAL: 'e',
      }),
    ).toEqual({ PATH: '/x', ANDROID_SERIAL: 'e' });
  });
  it('runTool: stdout bytes, exit code, stderr', async () => {
    const r = await runTool(
      node,
      [
        '-e',
        'process.stdout.write(Buffer.from([1,2,3]));process.stderr.write("warn");process.exitCode=3',
      ],
      { ...base, timeoutMs: 5000 },
    );
    expect([...r.stdout]).toEqual([1, 2, 3]);
    expect(r.code).toBe(3);
    expect(r.stderr).toBe('warn');
  });
  it('runTool: a timeout kills the child (SIGTERM, then SIGKILL after 2 s)', async () => {
    const started = Date.now();
    await expect(
      runTool(node, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {
        ...base,
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_FAILED', message: 'node timed out after 0.2 s.' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('runTool: abort and the stdout cap', async () => {
    const c = new AbortController();
    const p = runTool(node, ['-e', 'setInterval(()=>{},1000)'], {
      ...base,
      timeoutMs: 5000,
      signal: c.signal,
    });
    setTimeout(() => c.abort(), 100);
    await expect(p).rejects.toMatchObject({ code: 'CAPTURE_FAILED', message: 'node stopped.' });
    await expect(
      runTool(node, ['-e', 'process.stdout.write(Buffer.alloc(2048))'], {
        ...base,
        timeoutMs: 5000,
        maxStdout: 1024,
      }),
    ).rejects.toMatchObject({ message: 'node wrote more than 1024 bytes.' });
  });
  it('runTool: a file that cannot be started is CAPTURE_TOOL_MISSING', async () => {
    await expect(
      runTool({ name: 'adb', path: path.join(dir, 'nope') }, [], { ...base, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'CAPTURE_TOOL_MISSING' });
  });
});
