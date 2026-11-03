// Where the CLI finds the MCP server's shared modules (spec §5: one source, bundled into
// dist/bin.js). In the public mirror (Draggable/storeshot-cli) they are vendored, unchanged, under
// VENDOR_DIR. In the Storeshot monorepo they are the MCP package's own files, mapped by
// mirror/inputs.json (monorepo only, never exported); the mirror export copies exactly those files
// with the same map. Never copy them in by hand.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The vendored MCP package root in the mirror, relative to the CLI root. */
export const VENDOR_DIR = 'vendor/mcp';

const MAP_FILE = path.join(CLI_ROOT, 'mirror/inputs.json');
export const IN_MONOREPO = existsSync(MAP_FILE);
const map = IN_MONOREPO ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) : null;
if (map && map.vendor.dir !== VENDOR_DIR) {
  throw new Error(`mirror/inputs.json vendors into ${map.vendor.dir}, not ${VENDOR_DIR}`);
}

/** The MCP package root: packages/mcp-server in the monorepo, VENDOR_DIR in the mirror. */
export const MCP_ROOT = map
  ? path.resolve(CLI_ROOT, map.monorepoRoot, map.vendor.source)
  : path.join(CLI_ROOT, VENDOR_DIR);
