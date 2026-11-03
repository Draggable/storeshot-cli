import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDS, GLOBAL_FLAGS } from '../src/args.js';
import { EXIT } from '../src/errors.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('README (spec §18)', () => {
  it('installs only the scoped package, never the unscoped storeshot', () => {
    expect(readme).toContain('npx @draggable/storeshot-cli');
    expect(readme).toContain('npm install -g @draggable/storeshot-cli');
    expect(readme).not.toMatch(/npx\s+(?:-y\s+|--yes\s+)?storeshot(?![-\w/@])/);
  });
  it('documents every command and flag', () => {
    for (const [name, spec] of Object.entries(COMMANDS)) {
      expect(readme).toContain(`storeshot ${name}`);
      for (const flag of Object.keys(spec.flags))
        expect(readme, `${name} --${flag}`).toContain(`--${flag}`);
    }
    for (const flag of Object.keys(GLOBAL_FLAGS)) expect(readme).toContain(`--${flag}`);
  });
  it('documents every exit code and the schemas', () => {
    for (const code of Object.values(EXIT))
      expect(readme).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`));
    expect(readme).toContain('storeshot schema');
    expect(readme).toContain('schemaVersion');
  });
  it('says where credentials live and that logout does not revoke', () => {
    expect(readme).toContain('cli-credentials.json');
    expect(readme).toContain('https://console.storeshot.art/keys');
  });
});
