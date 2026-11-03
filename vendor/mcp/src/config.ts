import { realpathSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';
import { Storeshot } from '@draggable/storeshot-sdk';

export type Environment = 'test' | 'live';

export interface Config {
  apiKey: string | null;
  /**
   * The key's environment: from the STORESHOT_API_KEY prefix, else STORESHOT_ENVIRONMENT, else
   * null (the device flow sends none and the approver decides; amendment A2).
   */
  environment: Environment | null;
  baseUrl: string;
  root: string | null;
  noStore: boolean;
  debug: boolean;
  credentialsFile: string;
  warnings: string[];
  /** Set when the configuration cannot work: every tool answers INVALID_CONFIGURATION. */
  error: string | null;
}

export const DEFAULT_BASE_URL = 'https://api.storeshot.art/v1';
const KEY = /^ss_(live|test)_[A-Za-z0-9]{20,128}$/;

function normaliseBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/v1';
  // The SDK's own rules (https; http only for loopback; no credentials, query or fragment).
  return new Storeshot({ apiKey: null, baseUrl: url.href }).baseUrl;
}

export function readConfig(
  env: Record<string, string | undefined> = process.env,
  opts: { homedir?: string } = {},
): Config {
  const warnings: string[] = [];
  const errors: string[] = [];
  const home = opts.homedir ?? osHomedir();
  const apiKey = env.STORESHOT_API_KEY?.trim() || null;
  const requested = env.STORESHOT_ENVIRONMENT?.trim() || null;
  let environment: Environment | null = null;
  if (requested === 'test' || requested === 'live') environment = requested;
  else if (requested !== null) {
    errors.push(`STORESHOT_ENVIRONMENT must be "test" or "live" (got "${requested}").`);
  }
  if (apiKey) {
    const match = KEY.exec(apiKey);
    if (!match) {
      errors.push('STORESHOT_API_KEY is not a Storeshot API key (ss_test_… or ss_live_…).');
    } else {
      const keyEnvironment = match[1] as Environment;
      if (environment && keyEnvironment !== environment) {
        warnings.push(
          `STORESHOT_ENVIRONMENT=${environment} is ignored: STORESHOT_API_KEY is a ${keyEnvironment} key.`,
        );
      }
      environment = keyEnvironment;
    }
  }
  let baseUrl = DEFAULT_BASE_URL;
  try {
    baseUrl = normaliseBaseUrl(env.STORESHOT_BASE_URL?.trim() || DEFAULT_BASE_URL);
  } catch (error) {
    errors.push(`STORESHOT_BASE_URL: ${(error as Error).message}`);
  }
  let root: string | null = null;
  const rawRoot = env.STORESHOT_MCP_ROOT?.trim();
  if (rawRoot) {
    if (!path.isAbsolute(rawRoot)) errors.push('STORESHOT_MCP_ROOT must be an absolute path.');
    else {
      try {
        root = realpathSync(rawRoot);
        if (!statSync(root).isDirectory()) throw new Error('not a directory');
      } catch {
        root = null;
        errors.push(`STORESHOT_MCP_ROOT must be an existing directory (${rawRoot}).`);
      }
    }
  }
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config');
  return {
    apiKey: errors.length ? null : apiKey,
    environment,
    baseUrl,
    root,
    noStore: env.STORESHOT_MCP_NO_STORE === '1',
    debug: env.STORESHOT_MCP_DEBUG === '1',
    credentialsFile: path.join(configHome, 'storeshot', 'mcp-credentials.json'),
    warnings,
    error: errors.length ? errors.join(' ') : null,
  };
}
