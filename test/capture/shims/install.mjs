// Puts sh wrappers for xcrun, adb and maestro first on PATH (SS-023 spec §16.2). Each wrapper runs
// this folder's fake-tool.mjs with the absolute node of the test, so PATH order cannot change which
// node runs it. Everything lives in one fresh folder under packages/cli/.tmp/.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.resolve(HERE, '../../../.tmp');

export function installShims({ png, scenario = [] } = {}) {
  mkdirSync(TMP, { recursive: true });
  const dir = mkdtempSync(path.join(TMP, 'shims-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const log = path.join(dir, 'calls.jsonl');
  writeFileSync(log, '');
  const pngFile = path.join(dir, 'fixture.png');
  if (png) writeFileSync(pngFile, png);
  for (const tool of ['xcrun', 'adb', 'maestro']) {
    const file = path.join(bin, tool);
    writeFileSync(
      file,
      `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, 'fake-tool.mjs')}" ${tool} "$@"\n`,
    );
    chmodSync(file, 0o755);
  }
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    FAKE_TOOL_LOG: log,
    FAKE_PNG: pngFile,
    FAKE_TOOL_SCENARIO: scenario.join(','),
  };
  return {
    dir,
    bin,
    env,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
