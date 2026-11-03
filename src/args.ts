import { parseArgs } from 'node:util';
import { CliError } from './errors.js';

export type CommandName =
  | 'login'
  | 'logout'
  | 'whoami'
  | 'credits'
  | 'devices'
  | 'generate'
  | 'set'
  | 'status'
  | 'pull'
  | 'capture'
  | 'schema';
type Kind = 'boolean' | 'string' | 'list' | 'int';
export interface FlagSpec {
  kind: Kind;
  value?: string;
  help: string;
  short?: string;
  min?: number;
  max?: number;
}
export interface CommandSpec {
  summary: string;
  usage: string;
  positionals: [min: number, max: number];
  flags: Record<string, FlagSpec>;
}
export type FlagValue = string | boolean | string[] | number | undefined;
export interface Parsed {
  command: CommandName | null;
  positionals: string[];
  flags: Record<string, FlagValue>;
  help: boolean;
  version: boolean;
  bare: boolean;
}

export const GLOBAL_FLAGS: Record<string, FlagSpec> = {
  json: { kind: 'boolean', help: 'Write one JSON document to stdout (see storeshot schema).' },
  env: {
    kind: 'string',
    value: 'test|live',
    help: 'Environment (default test: free sample images).',
  },
  'api-key': {
    kind: 'string',
    value: '<key>',
    help: 'API key. Prefer STORESHOT_API_KEY: argv is visible to other users and in shell history.',
  },
  quiet: { kind: 'boolean', help: 'No progress or notices on stderr.' },
  'no-color': { kind: 'boolean', help: 'No colour on stderr (NO_COLOR is honoured too).' },
  help: { kind: 'boolean', short: 'h', help: 'Show help.' },
};
const WAIT: Record<string, FlagSpec> = {
  'no-wait': { kind: 'boolean', help: 'Return right after the job is created.' },
  timeout: {
    kind: 'int',
    value: '<seconds>',
    min: 1,
    max: 3600,
    help: 'Stop waiting after this long (default 600). The job continues.',
  },
};
const SPEND: Record<string, FlagSpec> = {
  yes: { kind: 'boolean', help: 'Confirm spending live credits without a prompt (CI, agents).' },
  'max-credits': {
    kind: 'int',
    value: '<n>',
    min: 0,
    max: 1_000_000,
    help: 'Refuse to spend more than n live credits (0 = must be free).',
  },
};
const OUT: Record<string, FlagSpec> = {
  out: {
    kind: 'string',
    value: '<dir>',
    help: 'Save the images into this folder (created if missing).',
  },
  force: { kind: 'boolean', help: 'Replace files that already exist.' },
};
const LAYOUT: FlagSpec = {
  kind: 'string',
  value: 'store|fastlane',
  help: 'store (default): <store>/<device>/NN.png; fastlane: --out is the project root.',
};
const IMAGE: Record<string, FlagSpec> = {
  'app-name': { kind: 'string', value: '<name>', help: 'App name (1–100 characters).' },
  'app-description': {
    kind: 'string',
    value: '<text>',
    help: 'App description (≤ 2000 characters).',
  },
  orientation: {
    kind: 'string',
    value: 'portrait|landscape',
    help: 'Orientation of the screenshots.',
  },
  palette: {
    kind: 'string',
    value: '#RRGGBB:Name,…',
    help: '1–8 colours (default: extracted from the screenshot).',
  },
  logo: { kind: 'string', value: '<file>', help: 'App icon or logo (PNG, JPEG or WebP).' },
  project: { kind: 'string', value: '<uuid>', help: 'Put the result in this project.' },
  'idempotency-key': {
    kind: 'string',
    value: '<key>',
    help: 'Repeat-safe key: a rerun with the same key returns the first job instead of charging again.',
  },
};
const KIND: FlagSpec = {
  kind: 'string',
  value: 'set|generation',
  help: 'What the id is (default: try a set, then a generation).',
};

export const COMMANDS: Record<CommandName, CommandSpec> = {
  login: {
    summary: 'Link this machine to your account (device flow) and store a key.',
    usage: 'storeshot login [--env test|live] [--no-wait]',
    positionals: [0, 0],
    flags: {
      'no-wait': {
        kind: 'boolean',
        help: 'Print the code and exit; run storeshot login again after approving.',
      },
      timeout: WAIT.timeout,
    },
  },
  logout: {
    summary: 'Forget the stored key (revoke it in the console).',
    usage: 'storeshot logout [--env test|live] [--all]',
    positionals: [0, 0],
    flags: { all: { kind: 'boolean', help: 'Forget the test and the live key.' } },
  },
  whoami: {
    summary: 'Show the account and key in use.',
    usage: 'storeshot whoami',
    positionals: [0, 0],
    flags: {},
  },
  credits: {
    summary: 'Show the credit balance.',
    usage: 'storeshot credits',
    positionals: [0, 0],
    flags: {},
  },
  devices: {
    summary: 'List output sizes (device ids).',
    usage: 'storeshot devices [--store app_store|google_play]',
    positionals: [0, 0],
    flags: {
      store: { kind: 'string', value: 'app_store|google_play', help: 'Only this store.' },
      'include-deprecated': { kind: 'boolean', help: 'Also list deprecated sizes.' },
    },
  },
  generate: {
    summary: 'One marketing image per screenshot, for one size.',
    usage: 'storeshot generate <files…> --store <store> --device <id> --app-name <name>',
    positionals: [1, 10],
    flags: {
      store: { kind: 'string', value: 'app_store|google_play', help: 'Target store (required).' },
      device: { kind: 'string', value: '<id>', help: 'A storeshot devices id of that store.' },
      size: { kind: 'string', value: '<W>x<H>', help: 'A catalogue size instead of --device.' },
      caption: {
        kind: 'string',
        value: '<text>',
        help: 'Caption for every image (default: derived).',
      },
      captions: {
        kind: 'string',
        value: '<file>',
        help: 'captions.json: a caption per file name.',
      },
      ...IMAGE,
      ...WAIT,
      ...OUT,
      ...SPEND,
    },
  },
  set: {
    summary: 'A whole store listing: every screen on every device, one charge.',
    usage:
      'storeshot set <dir> --store app_store[,google_play] [--devices <ids>] [--captions captions.json]',
    positionals: [1, 1],
    flags: {
      store: {
        kind: 'list',
        value: 'app_store,google_play',
        help: 'One or both stores (default: from --devices).',
      },
      devices: {
        kind: 'list',
        value: '<id,…>',
        help: 'Device ids (default: what each store requires).',
      },
      captions: {
        kind: 'string',
        value: '<file>',
        help: 'Screens and captions (default <dir>/captions.json).',
      },
      'feature-graphic': {
        kind: 'boolean',
        help: 'Add the Google Play feature graphic (+1 image).',
      },
      'dry-run': {
        kind: 'boolean',
        help: 'Quote only: images and credits; nothing is created or charged.',
      },
      layout: LAYOUT,
      ...IMAGE,
      ...WAIT,
      ...OUT,
      ...SPEND,
    },
  },
  status: {
    summary: 'Show a set or generation (optionally wait).',
    usage: 'storeshot status <id> [--wait]',
    positionals: [1, 1],
    flags: {
      kind: KIND,
      wait: { kind: 'boolean', help: 'Wait until it is final.' },
      timeout: WAIT.timeout,
    },
  },
  pull: {
    summary: 'Save the images of a set or generation.',
    usage: 'storeshot pull <id> --out <dir> [--layout fastlane]',
    positionals: [1, 1],
    flags: { kind: KIND, layout: LAYOUT, ...OUT },
  },
  capture: {
    summary: 'Raw screenshots from an iOS Simulator, an Android emulator/device or a web build.',
    usage:
      'storeshot capture ios|android [options]   |   storeshot capture web <url> [--route <path>]… [options]',
    positionals: [1, 2],
    flags: {
      out: {
        kind: 'string',
        value: '<dir>',
        help: 'Folder for the PNGs and captions.json (default screens).',
      },
      force: { kind: 'boolean', help: 'Replace PNGs that already exist.' },
      name: {
        kind: 'string',
        value: '<name>',
        help: 'File name (default NN, web NN-<route>); one screen only.',
      },
      caption: {
        kind: 'string',
        value: '<text>',
        help: 'Caption written to captions.json; one screen only.',
      },
      'app-name': { kind: 'string', value: '<name>', help: 'Set app.name in captions.json.' },
      'no-captions': { kind: 'boolean', help: 'Do not create or change captions.json.' },
      device: {
        kind: 'string',
        value: '<id>',
        help: '(web) viewport preset, default app_store_1290x2796; (ios, android) expected size, only reported.',
      },
      offline: { kind: 'boolean', help: 'Use the device list bundled with this CLI (no network).' },
      timeout: {
        kind: 'int',
        value: '<seconds>',
        min: 1,
        max: 600,
        help: 'Per tool call or page (default 30).',
      },
      udid: {
        kind: 'string',
        value: '<udid>',
        help: '(ios) The simulator (default: the only booted one).',
      },
      serial: {
        kind: 'string',
        value: '<serial>',
        help: '(android) The device (default: ANDROID_SERIAL, else the only one).',
      },
      'clean-status-bar': {
        kind: 'boolean',
        help: '(ios, android) 9:41, full signal and battery for the capture; restored afterwards.',
      },
      settle: {
        kind: 'int',
        value: '<ms>',
        min: 0,
        max: 10_000,
        help: '(ios, android) Wait after the status bar change (default 1000).',
      },
      'reset-status-bar': {
        kind: 'boolean',
        help: '(ios, android) Only restore the status bar (after a killed run); captures nothing.',
      },
      route: {
        kind: 'list',
        value: '<path,…>',
        help: '(web) Pages below <url>, in listing order (default: <url> itself).',
      },
      pages: {
        kind: 'string',
        value: '<file>',
        help: '(web) pages.json: path, name, caption, waitFor, delayMs per page (storeshot schema capture-pages).',
      },
      orientation: {
        kind: 'string',
        value: 'portrait|landscape',
        help: '(web) Viewport orientation (default portrait).',
      },
      'wait-until': {
        kind: 'string',
        value: 'load|domcontentloaded|networkidle',
        help: '(web) Navigation event to wait for (default load).',
      },
      'wait-for': {
        kind: 'string',
        value: '<css>',
        help: '(web) Wait until this selector is visible.',
      },
      delay: {
        kind: 'int',
        value: '<ms>',
        min: 0,
        max: 30_000,
        help: '(web) Extra wait before each screenshot (default 300).',
      },
      'color-scheme': {
        kind: 'string',
        value: 'light|dark',
        help: '(web) prefers-color-scheme (default light).',
      },
      locale: { kind: 'string', value: '<tag>', help: '(web) Browser locale (default en-US).' },
    },
  },
  schema: {
    summary: 'Print the JSON Schema of a command (offline).',
    usage: 'storeshot schema [command]',
    positionals: [0, 1],
    flags: {},
  },
};

const usageError = (message: string) => new CliError('USAGE', message);

export function parseCli(argv: string[]): Parsed {
  const empty = { positionals: [], flags: {}, help: false, version: false, bare: false };
  const first = argv[0];
  if (first === undefined) return { ...empty, command: null, help: true, bare: true };
  if (first.startsWith('-')) {
    if (argv.length === 1 && first === '--version')
      return { ...empty, command: null, version: true };
    if (argv.length === 1 && (first === '--help' || first === '-h'))
      return { ...empty, command: null, help: true };
    throw usageError(
      `Unexpected ${first}: the command comes first (storeshot <command> [options]).`,
    );
  }
  if (!Object.hasOwn(COMMANDS, first)) {
    throw usageError(`Unknown command "${first}". Commands: ${Object.keys(COMMANDS).join(', ')}.`);
  }
  const command = first as CommandName;
  const spec = COMMANDS[command];
  const all = { ...GLOBAL_FLAGS, ...spec.flags };
  const options = Object.fromEntries(
    Object.entries(all).map(([name, f]) => [
      name,
      {
        type: f.kind === 'boolean' ? ('boolean' as const) : ('string' as const),
        multiple: f.kind === 'list',
        ...(f.short ? { short: f.short } : {}),
      },
    ]),
  );
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv.slice(1), options, strict: true, allowPositionals: true });
  } catch (error) {
    throw usageError(`${(error as Error).message.split('\n')[0]} (storeshot ${command} --help)`);
  }
  const flags: Record<string, FlagValue> = {};
  for (const [name, raw] of Object.entries(parsed.values)) {
    const f = all[name];
    if (f.kind === 'list') {
      flags[name] = (raw as string[])
        .flatMap((v) => v.split(','))
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (f.kind === 'int') {
      const text = String(raw);
      const n = /^\d+$/.test(text) ? Number(text) : NaN;
      if (!Number.isSafeInteger(n) || n < (f.min ?? 0) || n > (f.max ?? Number.MAX_SAFE_INTEGER)) {
        throw usageError(`--${name} must be a whole number from ${f.min ?? 0} to ${f.max}.`);
      }
      flags[name] = n;
    } else flags[name] = raw as string | boolean;
  }
  const help = flags.help === true;
  const [min, max] = spec.positionals;
  if (!help && (parsed.positionals.length < min || parsed.positionals.length > max)) {
    throw usageError(`Usage: ${spec.usage}`);
  }
  return { command, positionals: parsed.positionals, flags, help, version: false, bare: false };
}

export const str = (p: Parsed, name: string): string | undefined =>
  typeof p.flags[name] === 'string' ? (p.flags[name] as string) : undefined;
export const bool = (p: Parsed, name: string): boolean => p.flags[name] === true;
export const list = (p: Parsed, name: string): string[] =>
  Array.isArray(p.flags[name]) ? (p.flags[name] as string[]) : [];
export const int = (p: Parsed, name: string): number | undefined =>
  typeof p.flags[name] === 'number' ? (p.flags[name] as number) : undefined;

const EXIT_HELP = [
  'Exit codes:',
  '  0  ok                  1  internal error        2  usage or invalid request',
  '  3  not logged in/auth  4  not enough credits    5  not found',
  '  6  rate limited        7  server error          8  network error',
  '  9  some images failed  10 still running (wait timed out)',
  '  11 live spend not confirmed / over --max-credits  12 local file or capture tool problem',
  '  130 interrupted (Ctrl-C)  143 terminated',
].join('\n');

const flagLines = (flags: Record<string, FlagSpec>) =>
  Object.entries(flags).map(([name, f]) => {
    const left = `  ${f.short ? `-${f.short}, ` : ''}--${name}${f.value ? ` ${f.value}` : ''}`;
    return `${left.padEnd(34)} ${f.help}`;
  });

export function helpText(command: CommandName | null): string {
  if (command === null) {
    return [
      'Storeshot CLI: App Store and Google Play screenshots from the command line and CI.',
      '',
      'Usage: storeshot <command> [options]   (or: npx @draggable/storeshot-cli <command>)',
      '',
      'Commands:',
      ...Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)} ${c.summary}`),
      '',
      'Options for every command:',
      ...flagLines(GLOBAL_FLAGS),
      '',
      'Environment: STORESHOT_API_KEY, STORESHOT_ENVIRONMENT (test|live), NO_COLOR.',
      'Test mode (the default) is free: sample images of the exact size.',
      '',
      EXIT_HELP,
      '',
      'Docs: https://storeshot.art/docs/  Help per command: storeshot <command> --help',
    ].join('\n');
  }
  const spec = COMMANDS[command];
  return [
    `${spec.summary}`,
    '',
    `Usage: ${spec.usage}`,
    '',
    'Options:',
    ...flagLines(spec.flags),
    ...flagLines(GLOBAL_FLAGS),
    '',
    EXIT_HELP,
  ].join('\n');
}
