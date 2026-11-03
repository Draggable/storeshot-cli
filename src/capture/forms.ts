import { bool, list, str, type Parsed } from '../args.js';
import { CliError } from '../errors.js';

export type Form = 'ios' | 'android' | 'web';
export const UDID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
/** SS-023 spec §5.2: starts alphanumeric (never an option), no spaces or shell characters. */
export const SERIAL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** Spec §11: output stems; a subset of captions.json's CAPTION_FILE_NAME (no spaces). */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const COMMON = [
  'out',
  'force',
  'name',
  'caption',
  'app-name',
  'no-captions',
  'device',
  'offline',
  'timeout',
];
const STATUS = ['clean-status-bar', 'settle', 'reset-status-bar'];
const WEB = [
  'route',
  'pages',
  'orientation',
  'wait-until',
  'wait-for',
  'delay',
  'color-scheme',
  'locale',
];
export const FORM_FLAGS: Record<Form, readonly string[]> = {
  ios: [...COMMON, 'udid', ...STATUS],
  android: [...COMMON, 'serial', ...STATUS],
  web: [...COMMON, ...WEB],
};
const RESET_ONLY = ['reset-status-bar', 'udid', 'serial', 'timeout'];
const usage = (message: string) => new CliError('USAGE', message);
const oneOf = (p: Parsed, flag: string, values: string[]) => {
  const v = str(p, flag);
  if (v !== undefined && !values.includes(v))
    throw usage(`--${flag} must be ${values.join(' or ')}.`);
};
const length = (p: Parsed, flag: string, min: number, max: number) => {
  const v = str(p, flag);
  if (v !== undefined && (v.length < min || v.length > max))
    throw usage(`--${flag} must be ${min}–${max} characters.`);
};

export function parseForm(p: Parsed): Form {
  const form = p.positionals[0];
  if (form !== 'ios' && form !== 'android' && form !== 'web')
    throw usage(`Unknown capture form "${form}": use ios, android or web.`);
  const want = form === 'web' ? 2 : 1;
  if (p.positionals.length !== want) {
    throw usage(
      form === 'web'
        ? 'Usage: storeshot capture web <url> [--route <path>]… [options]'
        : `Usage: storeshot capture ${form} [options] (no other arguments).`,
    );
  }
  return form;
}

/** Spec §3: flags of another form, --reset-status-bar combinations, value rules. */
export function checkFormFlags(p: Parsed, form: Form, globals: readonly string[]): void {
  const given = Object.keys(p.flags);
  for (const flag of given) {
    if (globals.includes(flag) || FORM_FLAGS[form].includes(flag)) continue;
    const forms = (Object.keys(FORM_FLAGS) as Form[]).filter((f) => FORM_FLAGS[f].includes(flag));
    throw usage(`--${flag} applies to capture ${forms.join('/')} only.`);
  }
  if (bool(p, 'reset-status-bar')) {
    const extra = given.filter((f) => !globals.includes(f) && !RESET_ONLY.includes(f));
    if (extra.length)
      throw usage(
        `--reset-status-bar only takes --udid/--serial and --timeout (got --${extra[0]}).`,
      );
  }
  if (list(p, 'route').length && str(p, 'pages') !== undefined)
    throw usage('Pass --route or --pages, not both.');
  if (bool(p, 'no-captions') && str(p, 'app-name') !== undefined)
    throw usage('--app-name writes captions.json: drop --no-captions or --app-name.');
  const udid = str(p, 'udid');
  if (udid !== undefined && !UDID.test(udid))
    throw usage('--udid must be a simulator UDID (xcrun simctl list devices booted).');
  const serial = str(p, 'serial');
  if (serial !== undefined && !SERIAL.test(serial))
    throw usage('--serial must be a device serial from adb devices (e.g. emulator-5554).');
  const locale = str(p, 'locale');
  if (locale !== undefined && !LOCALE.test(locale))
    throw usage('--locale must be a language tag such as en-US.');
  oneOf(p, 'wait-until', ['load', 'domcontentloaded', 'networkidle']);
  oneOf(p, 'color-scheme', ['light', 'dark']);
  oneOf(p, 'orientation', ['portrait', 'landscape']);
  length(p, 'caption', 1, 1000);
  length(p, 'app-name', 1, 100);
  length(p, 'wait-for', 1, 500);
  // int flags (--timeout, --settle, --delay) are range-checked by parseCli already.
}

export function fileNameOf(value: string): string {
  const stem = value.replace(/\.png$/i, '');
  if (!NAME.test(stem)) {
    throw usage(
      `--name "${value}" must be 1–100 letters, digits, ".", "_" or "-", starting with a letter or digit.`,
    );
  }
  return `${stem}.png`;
}

export function checkUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw usage(`"${value}" is not a URL (for example http://localhost:8081).`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw usage('capture web takes an http:// or https:// URL.');
  if (url.username || url.password)
    throw usage('The URL must not contain a user name or password.');
  if (value.length > 2000) throw usage('The URL is longer than 2000 characters.');
  return url;
}

/** Spec §9.2: a route below <url>, same origin only. */
export function resolveRoute(base: URL, route: string): string {
  if (!route.startsWith('/') || route.length > 2000 || route.includes('\u0000'))
    throw usage(`Route "${route}" must start with / (at most 2000 characters).`);
  const url = new URL(route, base);
  if (url.origin !== base.origin) throw usage(`Route "${route}" leaves ${base.origin}.`);
  return url.href;
}
