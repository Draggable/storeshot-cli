import { homedir as osHomedir } from 'node:os';
import path from 'node:path';
import { Storeshot } from '@draggable/storeshot-sdk';
import { CliError } from './errors.js';

export type Environment = 'test' | 'live';
export const DEFAULT_BASE_URL = 'https://api.storeshot.art/v1';
/** The MCP server's rule (ss_test_… / ss_live_…). */
export const KEY_PATTERN = /^ss_(live|test)_[A-Za-z0-9]{20,128}$/;

export interface CliConfig {
  baseUrl: string;
  environment: Environment;
  environmentFrom: 'key' | 'flag' | 'env' | 'default';
  explicitKey: { value: string; source: 'flag' | 'env' } | null;
  configDir: string;
  credentialsFile: string;
  pendingFile: string;
}

/** The SDK's rules (https; http only on loopback), and a bare origin gets /v1 (as the MCP server). */
export function normaliseBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/v1';
  return new Storeshot({ apiKey: null, baseUrl: url.href }).baseUrl;
}

const asEnvironment = (value: string): Environment | null =>
  value === 'test' || value === 'live' ? value : null;

/** Spec §6: explicit key > --env > STORESHOT_ENVIRONMENT > test. Pure: env and home are inputs. */
export function resolveConfig(
  input: { env?: string; apiKey?: string },
  env: Record<string, string | undefined>,
  opts: { homedir?: string } = {},
): CliConfig {
  let baseUrl: string;
  try {
    baseUrl = normaliseBaseUrl(env.STORESHOT_BASE_URL?.trim() || DEFAULT_BASE_URL);
  } catch (error) {
    throw new CliError('INVALID_CONFIGURATION', `STORESHOT_BASE_URL: ${(error as Error).message}`);
  }
  let requested: { environment: Environment; from: 'flag' | 'env' } | null = null;
  if (input.env !== undefined) {
    const e = asEnvironment(input.env);
    if (!e) throw new CliError('USAGE', `--env must be test or live (got "${input.env}").`);
    requested = { environment: e, from: 'flag' };
  } else if (env.STORESHOT_ENVIRONMENT?.trim()) {
    const raw = env.STORESHOT_ENVIRONMENT.trim();
    const e = asEnvironment(raw);
    if (!e) {
      throw new CliError(
        'INVALID_CONFIGURATION',
        `STORESHOT_ENVIRONMENT must be test or live (got "${raw}").`,
      );
    }
    requested = { environment: e, from: 'env' };
  }
  let explicitKey: CliConfig['explicitKey'] = null;
  if (input.apiKey !== undefined) {
    if (!KEY_PATTERN.test(input.apiKey)) {
      throw new CliError('USAGE', '--api-key is not a Storeshot API key (ss_test_… or ss_live_…).');
    }
    explicitKey = { value: input.apiKey, source: 'flag' };
  } else if (env.STORESHOT_API_KEY?.trim()) {
    const value = env.STORESHOT_API_KEY.trim();
    if (!KEY_PATTERN.test(value)) {
      throw new CliError(
        'INVALID_CONFIGURATION',
        'STORESHOT_API_KEY is not a Storeshot API key (ss_test_… or ss_live_…).',
      );
    }
    explicitKey = { value, source: 'env' };
  }
  let environment: Environment = requested?.environment ?? 'test';
  let environmentFrom: CliConfig['environmentFrom'] = requested?.from ?? 'default';
  if (explicitKey) {
    const keyEnvironment = KEY_PATTERN.exec(explicitKey.value)![1] as Environment;
    if (requested && requested.environment !== keyEnvironment) {
      throw new CliError(
        'ENVIRONMENT_MISMATCH',
        `${requested.from === 'flag' ? '--env' : 'STORESHOT_ENVIRONMENT'} is ${requested.environment} but the ${explicitKey.source === 'flag' ? '--api-key' : 'STORESHOT_API_KEY'} key is a ${keyEnvironment} key.`,
      );
    }
    environment = keyEnvironment;
    environmentFrom = 'key';
  }
  const home = opts.homedir ?? osHomedir();
  const configDir = path.join(
    env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config'),
    'storeshot',
  );
  return {
    baseUrl,
    environment,
    environmentFrom,
    explicitKey,
    configDir,
    credentialsFile: path.join(configDir, 'cli-credentials.json'),
    pendingFile: path.join(configDir, 'cli-device.json'),
  };
}
