# Vendored Storeshot MCP server files

The files in this folder are copies, unchanged, of files of the Storeshot MCP server
(`@draggable/storeshot-mcp`, public repository `Draggable/storeshot-mcp`, at the same paths
there; Apache-2.0 like this package, same copyright holder). They are the credential store, the
local file rules (checked screenshot reads, safe downloads, archive extraction), the error type the
CLI shares with the MCP server, and one test helper.

`scripts/build.mjs` bundles them into `dist/bin.js`: the CLI has no runtime dependency on the MCP
server package. Every release replaces them with the MCP server's files of the same release, so
do not change them here: changes belong in the MCP server.
