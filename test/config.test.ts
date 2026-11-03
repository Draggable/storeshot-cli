import path from 'node:path';
import { readConfig as mcpReadConfig } from '@storeshot/mcp-src/config.js';
import { describe, expect, it } from 'vitest';
import { normaliseBaseUrl, resolveConfig } from '../src/config.js';

const TEST = 'ss_test_' + 'a'.repeat(32);
const LIVE = 'ss_live_' + 'b'.repeat(32);
const HOME = path.join(path.sep, 'Users', 'dev');
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'ok';
};

describe('resolveConfig (spec §6)', () => {
  it('defaults to test, the production base URL and ~/.config/storeshot', () => {
    const c = resolveConfig({}, {}, { homedir: HOME });
    expect(c).toMatchObject({
      environment: 'test',
      environmentFrom: 'default',
      explicitKey: null,
      baseUrl: 'https://api.storeshot.art/v1',
    });
    expect(c.credentialsFile).toBe(path.join(HOME, '.config', 'storeshot', 'cli-credentials.json'));
    expect(c.pendingFile).toBe(path.join(HOME, '.config', 'storeshot', 'cli-device.json'));
  });
  it('honours XDG_CONFIG_HOME', () => {
    const xdg = path.join(HOME, 'xdg');
    expect(resolveConfig({}, { XDG_CONFIG_HOME: xdg }, { homedir: HOME }).configDir).toBe(
      path.join(xdg, 'storeshot'),
    );
  });
  it('--api-key beats STORESHOT_API_KEY; the key prefix sets the environment', () => {
    const c = resolveConfig({ apiKey: LIVE }, { STORESHOT_API_KEY: TEST }, { homedir: HOME });
    expect(c.explicitKey).toEqual({ value: LIVE, source: 'flag' });
    expect(c).toMatchObject({ environment: 'live', environmentFrom: 'key' });
    expect(resolveConfig({}, { STORESHOT_API_KEY: TEST }, { homedir: HOME }).explicitKey).toEqual({
      value: TEST,
      source: 'env',
    });
  });
  it('--env beats STORESHOT_ENVIRONMENT', () => {
    expect(
      resolveConfig({ env: 'live' }, { STORESHOT_ENVIRONMENT: 'test' }, { homedir: HOME }),
    ).toMatchObject({ environment: 'live', environmentFrom: 'flag' });
    expect(resolveConfig({}, { STORESHOT_ENVIRONMENT: 'live' }, { homedir: HOME })).toMatchObject({
      environment: 'live',
      environmentFrom: 'env',
    });
  });
  it('a key of the other environment is ENVIRONMENT_MISMATCH, not a warning', () => {
    expect(
      code(() => resolveConfig({ env: 'test' }, { STORESHOT_API_KEY: LIVE }, { homedir: HOME })),
    ).toBe('ENVIRONMENT_MISMATCH');
    expect(
      code(() =>
        resolveConfig({ apiKey: TEST }, { STORESHOT_ENVIRONMENT: 'live' }, { homedir: HOME }),
      ),
    ).toBe('ENVIRONMENT_MISMATCH');
  });
  it('bad values are usage or configuration errors', () => {
    expect(code(() => resolveConfig({ env: 'prod' }, {}, { homedir: HOME }))).toBe('USAGE');
    expect(
      code(() => resolveConfig({}, { STORESHOT_ENVIRONMENT: 'prod' }, { homedir: HOME })),
    ).toBe('INVALID_CONFIGURATION');
    expect(code(() => resolveConfig({ apiKey: 'sk_nope' }, {}, { homedir: HOME }))).toBe('USAGE');
    expect(code(() => resolveConfig({}, { STORESHOT_API_KEY: 'nope' }, { homedir: HOME }))).toBe(
      'INVALID_CONFIGURATION',
    );
    expect(
      code(() =>
        resolveConfig({}, { STORESHOT_BASE_URL: 'http://example.com/v1' }, { homedir: HOME }),
      ),
    ).toBe('INVALID_CONFIGURATION');
  });
});

describe('normaliseBaseUrl matches the MCP server and the SDK', () => {
  it.each([
    'https://api.storeshot.art',
    'https://api.storeshot.art/',
    'https://api.storeshot.art/v1',
    'https://api.storeshot.art/v1/',
    'http://127.0.0.1:4010/v1',
    'http://localhost:4010',
  ])('%s', (input) => {
    expect(normaliseBaseUrl(input)).toBe(mcpReadConfig({ STORESHOT_BASE_URL: input }).baseUrl);
  });
});
