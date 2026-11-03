import { Storeshot } from '@draggable/storeshot-sdk';
import { sniff } from '@storeshot/mcp-src/images/sniff.js';
import { describe, expect, it } from 'vitest';
import { CLI_VERSION, clientIdentity } from '../src/version.js';

describe('workspace skeleton', () => {
  it('resolves the SDK and the shared MCP modules from source', () => {
    expect(typeof Storeshot).toBe('function');
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
  });
  it('has a dev version and a valid client identity', () => {
    expect(CLI_VERSION).toBe('0.0.0-dev');
    expect(`${clientIdentity().surface}/${clientIdentity().name}`).toMatch(
      /^cli\/storeshot-cli@[A-Za-z0-9._@+-]+$/,
    );
  });
});
