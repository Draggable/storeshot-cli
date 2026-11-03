// The only importer of the MCP server's shared modules (spec §5): one source for the credential
// store and the local file rules of both tools, bundled into dist/bin.js by scripts/build.mjs.
// The exact set of bundled files is pinned by test/monorepo/mcpImports.test.ts.
export { CredentialStore, type StoredKey } from '@storeshot/mcp-src/auth/store.js';
export { McpToolError, type LocalErrorCode } from '@storeshot/mcp-src/errors.js';
export {
  readImageFile,
  MAX_UPLOAD_BYTES,
  type ImageFile,
} from '@storeshot/mcp-src/files/readImage.js';
export { TreeWriter, type WrittenFile } from '@storeshot/mcp-src/files/writeTree.js';
export { isLoopbackUrl } from '@storeshot/mcp-src/files/download.js';
export {
  saveGenerationResult,
  saveSetArchive,
  type ArchiveLayout,
  type MissingImage,
  type SavedFile,
  type SavedResults,
} from '@storeshot/mcp-src/files/results.js';
