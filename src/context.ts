import { Storeshot } from '@draggable/storeshot-sdk';
import type { Parsed } from './args.js';
import type { CliConfig, Environment } from './config.js';
import { CliError, type KeySource } from './errors.js';
import type { Output } from './output.js';
import { PendingStore } from './pending.js';
import { CredentialStore } from './shared/mcp.js';
import { clientIdentity } from './version.js';

export interface Ctx {
  args: Parsed;
  config: CliConfig;
  out: Output;
  signal: AbortSignal;
  cwd: string;
  stdinIsTTY: boolean;
  store: CredentialStore;
  pending: PendingStore;
  now(): number;
  createClient(apiKey: string | null): Storeshot;
  prompt(question: string): Promise<string | null>;
  /** Set by keyed(). */
  keySource: KeySource | null;
  keyEnvironment: Environment | null;
  keyId: string | null;
  /** The job this run created, for INTERRUPTED/WAIT_TIMEOUT reports. */
  job: { kind: 'generation' | 'screenshot_set'; id: string } | null;
  client: Storeshot | null;
  /** Set poll interval override (tests only; production uses the 3 s default of wait.ts). */
  pollMs?: number;
}

export interface CtxInput {
  args: Parsed;
  config: CliConfig;
  out: Output;
  signal: AbortSignal;
  cwd: string;
  stdinIsTTY: boolean;
  now?: () => number;
  createClient?: (apiKey: string | null) => Storeshot;
  prompt: (question: string) => Promise<string | null>;
  pollMs?: number;
}

export function createCtx(input: CtxInput): Ctx {
  const warn = (m: string) => input.out.warn(m);
  return {
    ...input,
    now: input.now ?? Date.now,
    createClient:
      input.createClient ??
      ((apiKey) =>
        new Storeshot({ apiKey, baseUrl: input.config.baseUrl, client: clientIdentity() })),
    store: new CredentialStore(input.config.credentialsFile, warn),
    pending: new PendingStore(input.config.pendingFile, warn),
    keySource: null,
    keyEnvironment: null,
    keyId: null,
    job: null,
    client: null,
  };
}

/** Spec §6: --api-key > STORESHOT_API_KEY > the stored key of the resolved environment. */
export async function keyed(ctx: Ctx): Promise<Storeshot> {
  if (ctx.client) return ctx.client;
  const { config } = ctx;
  if (config.explicitKey) {
    ctx.out.addSecret(config.explicitKey.value);
    ctx.client = ctx.createClient(config.explicitKey.value);
    ctx.keySource = config.explicitKey.source;
    ctx.keyEnvironment = config.environment;
    return ctx.client;
  }
  const stored = ctx.store.read(config.baseUrl, config.environment);
  if (!stored) {
    throw new CliError(
      'NOT_LOGGED_IN',
      `No ${config.environment} key for ${new URL(config.baseUrl).host}.`,
      {
        hint:
          config.environment === 'test'
            ? 'Run storeshot login (a free test key), or set STORESHOT_API_KEY.'
            : 'Run storeshot login --env live, or set STORESHOT_API_KEY to a live key.',
      },
    );
  }
  ctx.out.addSecret(stored.apiKey);
  ctx.client = ctx.createClient(stored.apiKey);
  ctx.keySource = 'stored';
  ctx.keyEnvironment = stored.environment;
  ctx.keyId = stored.keyId;
  return ctx.client;
}
