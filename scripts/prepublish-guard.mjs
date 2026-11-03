#!/usr/bin/env node
// `prepublishOnly` of @draggable/storeshot-cli (SS-022; owner decision of 3 Nov 2026: published
// like the SDK and the MCP server). The package is published only by .github/workflows/publish.yml
// of the PUBLIC mirror Draggable/storeshot-cli (npm provenance needs a public repository; that
// workflow sets STORESHOT_CLI_PUBLISH=1), never from the Storeshot monorepo, another mirror or a
// laptop, and only under the Apache-2.0 licence with its LICENSE and NOTICE files. Dry runs
// (`npm publish --dry-run`) are held to the same rules.
import { existsSync, readFileSync } from 'node:fs';

const PUBLISH_REPOSITORY = 'Draggable/storeshot-cli';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dryRun = process.env.npm_config_dry_run === 'true';
const problems = [];
if (
  process.env.STORESHOT_CLI_PUBLISH !== '1' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.GITHUB_REPOSITORY !== PUBLISH_REPOSITORY
) {
  problems.push(
    `publishing ${pkg.name} is only done by .github/workflows/publish.yml of ${PUBLISH_REPOSITORY}`,
  );
}
if (pkg.license !== 'Apache-2.0') {
  problems.push(`the licence must be Apache-2.0 (package.json says ${pkg.license ?? 'nothing'})`);
}
const missing = ['LICENSE', 'NOTICE'].filter(
  (f) => !existsSync(new URL(`../${f}`, import.meta.url)),
);
if (missing.length) problems.push(`LICENSE and NOTICE must ship (missing ${missing.join(', ')})`);
if (problems.length) {
  for (const problem of problems) console.error(`refusing to publish: ${problem}`);
  process.exit(1);
}
console.log(`publishing ${pkg.name}@${pkg.version}${dryRun ? ' (dry run)' : ''}`);
