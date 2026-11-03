// Bundles src/bin.ts and the shared MCP modules (alias @storeshot/mcp-src → the MCP package's
// source, spec §5: one source, no runtime dependency on @draggable/storeshot-mcp; vendored copies
// in the public mirror, scripts/inputs.mjs) into one dist/bin.js; the runtime dependencies stay
// external. Stamps the version, keeps the shebang.
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { CLI_ROOT, MCP_ROOT } from './inputs.mjs';

const MCP_SRC = path.join(MCP_ROOT, 'src');
const pkg = JSON.parse(readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
const outfile = path.join(CLI_ROOT, 'dist/bin.js');
rmSync(path.join(CLI_ROOT, 'dist'), { recursive: true, force: true });
const external = Object.keys(pkg.dependencies);
const result = await build({
  entryPoints: [path.join(CLI_ROOT, 'src/bin.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external,
  alias: { '@storeshot/mcp-src': MCP_SRC },
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});
const imports = Object.values(result.metafile.outputs).flatMap((o) => o.imports.map((i) => i.path));
const bare = [
  ...new Set(imports.filter((p) => !p.startsWith('node:') && !p.startsWith('.'))),
].sort();
const unexpected = bare.filter((p) => !external.some((e) => p === e || p.startsWith(`${e}/`)));
if (unexpected.length)
  throw new Error(`dist/bin.js imports undeclared packages: ${unexpected.join(', ')}`);
const text = readFileSync(outfile, 'utf8');
if (!text.startsWith('#!/usr/bin/env node\n')) throw new Error('dist/bin.js lost its shebang');
// esbuild keeps the `0.0.0-dev` fallback as a dead branch (no minify): check the define landed.
if (!text.includes(`CLI_VERSION = true ? ${JSON.stringify(pkg.version)} :`)) {
  throw new Error('dist/bin.js was not stamped with the package version');
}
chmodSync(outfile, 0o755);
console.log(`built ${pkg.name} ${pkg.version} (${Math.round(text.length / 1024)} KB)`);
