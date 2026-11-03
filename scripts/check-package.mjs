// Packs the CLI (in the monorepo also @draggable/storeshot-sdk of the same version, lockstep: that
// version may not be on npm yet; the public mirror installs the published SDK it depends on),
// checks the tarball's file list, installs the tarball(s) into a temp consumer, runs
// test-dist/bin.test.mjs against the installed bin and runs it as `storeshot` through npm exec
// (what npx runs). Temp data: .pack/ (git-ignored); `--keep` keeps it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CLI_ROOT, IN_MONOREPO } from './inputs.mjs';

const keep = process.argv.includes('--keep');
const pkg = JSON.parse(readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
const pack = path.join(CLI_ROOT, '.pack');
rmSync(pack, { recursive: true, force: true });
mkdirSync(pack, { recursive: true });
const npm = (args, cwd) =>
  execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const packed = [JSON.parse(npm(['pack', '--json', '--pack-destination', pack], CLI_ROOT))[0]];
if (IN_MONOREPO) {
  const sdk = path.resolve(CLI_ROOT, '../sdk');
  packed.push(JSON.parse(npm(['pack', '--json', '--pack-destination', pack], sdk))[0]);
}
const files = packed[0].files.map((f) => f.path).sort();
const allowed = (f) =>
  ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE', 'dist/bin.js'].includes(f) ||
  /^schemas\/[\w.-]+\.json$/.test(f);
const unexpected = files.filter((f) => !allowed(f));
if (unexpected.length) throw new Error(`unexpected files in the tarball: ${unexpected.join(', ')}`);
for (const must of [
  'dist/bin.js',
  'schemas/index.json',
  'schemas/envelope.schema.json',
  'LICENSE',
  'NOTICE',
  'README.md',
]) {
  if (!files.includes(must)) throw new Error(`the tarball lacks ${must}`);
}
const consumer = path.join(pack, 'consumer');
mkdirSync(consumer);
writeFileSync(
  path.join(consumer, 'package.json'),
  JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
);
npm(
  [
    'install',
    '--prefer-offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...packed.map((p) => path.join(pack, p.filename)),
  ],
  consumer,
);
const bin = path.join(consumer, 'node_modules', ...pkg.name.split('/'), pkg.bin.storeshot);
const tests = spawnSync(
  process.execPath,
  ['--test', path.join(CLI_ROOT, 'test-dist/bin.test.mjs')],
  {
    stdio: 'inherit',
    env: { ...process.env, STORESHOT_CLI_BIN: bin },
  },
);
if (tests.status !== 0) process.exit(tests.status ?? 1);
const viaExec = npm(['exec', '--offline', '--', 'storeshot', '--version'], consumer).trim();
if (viaExec !== pkg.version) throw new Error(`npm exec storeshot --version printed "${viaExec}"`);
console.log(
  `package ok: ${pkg.name}@${pkg.version}, ${files.length} files, ${packed[0].size} bytes packed (${packed[0].unpackedSize} unpacked), bin storeshot → ${bin}`,
);
if (!keep) rmSync(pack, { recursive: true, force: true });
