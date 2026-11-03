import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The vendored MCP server modules (vendor/mcp, see its README); the SDK is the installed package.
const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@storeshot\/mcp-src\/(.*)\.js$/, replacement: `${at('./vendor/mcp/src/')}$1.ts` },
      {
        find: /^@storeshot\/mcp-test\/(.*)\.js$/,
        replacement: `${at('./vendor/mcp/test/')}$1.ts`,
      },
    ],
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
