import { CAPTION_FILE_NAME } from './captions.js';

/** Spec §11.2: the machine contract of `--json` (schemaVersion 1, additive changes only). */
export const SCHEMA_VERSION = 1;
const BASE = 'https://storeshot.art/schemas/cli/v1/';
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
type J = Record<string, unknown>;

const str: J = { type: 'string' };
const int: J = { type: 'integer' };
const bool: J = { type: 'boolean' };
const num: J = { type: 'number' };
const nullable = (s: J): J => ({ anyOf: [s, { type: 'null' }] });
const arr = (items: J): J => ({ type: 'array', items });
const obj = (properties: Record<string, J>, optional: string[] = []): J => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  additionalProperties: false,
});
const ENV: J = { enum: ['test', 'live'] };
const STORE: J = { enum: ['app_store', 'google_play'] };
const ORIENTATION: J = { enum: ['portrait', 'landscape'] };
const GENERATION_STATUS: J = { enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'] };
const SET_STATUS: J = {
  enum: ['queued', 'running', 'succeeded', 'partially_failed', 'failed', 'canceled'],
};

const waited = obj({ seconds: int, timedOut: bool });
const savedFile = obj({
  path: str,
  relativePath: str,
  bytes: int,
  sha256: str,
  store: nullable(STORE),
  device: nullable(str),
  position: nullable(int),
});
const missing = obj({
  store: nullable(STORE),
  device: nullable(str),
  position: nullable(int),
  status: str,
  errorCode: nullable(str),
});
const pull = obj({
  kind: { enum: ['generation', 'screenshot_set'] },
  id: str,
  folder: str,
  layout: { enum: ['store', 'fastlane'] },
  files: arr(savedFile),
  complete: bool,
  missing: arr(missing),
});
const generationView = obj({
  input: nullable(str),
  uploadId: nullable(str),
  id: str,
  status: GENERATION_STATUS,
  environment: ENV,
  store: STORE,
  device: str,
  width: int,
  height: int,
  creditsCharged: int,
  creditsRefunded: int,
  error: nullable(obj({ code: str, message: str })),
});
const counts = obj({ queued: int, running: int, succeeded: int, failed: int, canceled: int });
const setView = obj({
  id: str,
  status: SET_STATUS,
  environment: ENV,
  appName: str,
  images: int,
  counts,
  creditsCharged: int,
  creditsRefunded: int,
  stores: arr(obj({ store: STORE, devices: arr(str), featureGraphic: bool })),
});
const quoteView = obj({
  environment: ENV,
  images: int,
  credits: int,
  availableCredits: int,
  sufficient: bool,
  screens: int,
  breakdown: arr(
    obj({
      store: STORE,
      device: str,
      width: int,
      height: int,
      orientation: ORIENTATION,
      images: int,
      defaulted: bool,
    }),
  ),
});
const error = obj(
  {
    code: str,
    message: str,
    hint: str,
    status: nullable(int),
    requestId: nullable(str),
    docUrl: nullable(str),
    retryAfterSeconds: nullable(num),
    details: { type: 'object' },
  },
  ['details'],
);

const DATA = {
  login: obj({
    status: { enum: ['linked', 'pending'] },
    alreadyLinked: bool,
    environment: ENV,
    keyId: nullable(str),
    scopes: arr(str),
    credentialsFile: nullable(str),
    userCode: nullable(str),
    verificationUri: nullable(str),
    verificationUriComplete: nullable(str),
    expiresAt: nullable(str),
  }),
  logout: obj({
    removed: arr(obj({ environment: ENV, keyId: str })),
    credentialsFile: str,
    revokeUrl: str,
  }),
  whoami: obj({
    user: obj({ id: str, displayName: nullable(str), email: nullable(str) }),
    credential: obj({
      type: { enum: ['user_token', 'api_key'] },
      environment: ENV,
      scopes: arr(str),
      keyId: nullable(str),
      keyName: nullable(str),
      keyPrefix: nullable(str),
      expiresAt: nullable(str),
    }),
    keySource: { enum: ['flag', 'env', 'stored'] },
    baseUrl: str,
    credentialsFile: nullable(str),
  }),
  credits: obj({
    environment: ENV,
    total: int,
    balances: obj({ starter: int, subscription: int, purchased: int }),
  }),
  devices: obj({
    devices: arr(
      obj({
        id: str,
        store: STORE,
        kind: str,
        label: str,
        width: int,
        height: int,
        orientations: arr(ORIENTATION),
        deprecated: bool,
        replacedBy: nullable(str),
      }),
    ),
  }),
  generate: obj({
    environment: ENV,
    creditsCharged: int,
    creditsRefunded: int,
    waited: nullable(waited),
    generations: arr(generationView),
    download: nullable(obj({ folder: str, files: arr(savedFile) })),
  }),
  set: obj({
    mode: { enum: ['quote', 'set'] },
    quote: nullable(quoteView),
    set: nullable(setView),
    waited: nullable(waited),
    download: nullable(pull),
  }),
  status: obj({
    kind: { enum: ['generation', 'screenshot_set'] },
    id: str,
    status: str,
    final: bool,
    environment: ENV,
    waited: nullable(waited),
    set: nullable(setView),
    generation: nullable(generationView),
  }),
  pull,
};
export type DataCommand = keyof typeof DATA;

const envelopeOf = (command: string | null, data: J): J => ({
  $schema: DRAFT,
  $id: `${BASE}${command ?? 'envelope'}.json`,
  title: command ? `storeshot ${command} --json` : 'storeshot --json envelope',
  type: 'object',
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    command: command ? { const: command } : str,
    ok: bool,
    exitCode: int,
    data: command ? nullable(data) : {},
    warnings: arr(str),
    error: nullable(error),
  },
  required: ['schemaVersion', 'command', 'ok', 'exitCode', 'data', 'warnings', 'error'],
  additionalProperties: false,
});

const CAPTIONS: J = {
  $schema: DRAFT,
  $id: `${BASE}captions.json`,
  title: 'storeshot set --captions captions.json',
  type: 'object',
  properties: {
    app: obj(
      {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string', maxLength: 2000 },
      },
      ['description'],
    ),
    screens: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: obj({
        file: { type: 'string', pattern: CAPTION_FILE_NAME.source },
        caption: { type: 'string', minLength: 1, maxLength: 1000 },
      }),
    },
    featureGraphic: {
      anyOf: [
        bool,
        obj(
          {
            screen: { type: 'integer', minimum: 1, maximum: 10 },
            caption: { type: 'string', minLength: 1, maxLength: 1000 },
          },
          ['caption'],
        ),
      ],
    },
  },
  required: ['screens'],
  additionalProperties: false,
};

const commands = Object.keys(DATA) as DataCommand[];
export const SCHEMAS: Record<string, J> = {
  index: {
    schemaVersion: SCHEMA_VERSION,
    envelope: 'envelope.schema.json',
    captions: 'captions.schema.json',
    commands: Object.fromEntries(commands.map((c) => [c, `${c}.schema.json`])),
  },
  envelope: envelopeOf(null, {}),
  captions: CAPTIONS,
  ...Object.fromEntries(commands.map((c) => [c, envelopeOf(c, DATA[c])])),
};
export const schemaFileName = (name: string) =>
  name === 'index' ? 'index.json' : `${name}.schema.json`;
