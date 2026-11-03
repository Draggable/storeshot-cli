declare const __CLI_VERSION__: string | undefined;

/** Stamped by scripts/build.mjs (esbuild `define`); `0.0.0-dev` in tests and typecheck. */
export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.0.0-dev';

/** The device-flow `client_name` (an unverified label in the console). */
export const CLIENT_NAME = 'Storeshot CLI';

/** `X-Storeshot-Client: cli/storeshot-cli@<version>` (usage source `cli`). */
export const clientIdentity = () => ({
  surface: 'cli' as const,
  name: `storeshot-cli@${CLI_VERSION}`,
});
