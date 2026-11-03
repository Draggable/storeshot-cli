import { CliError } from '../errors.js';
import { SERIAL } from './forms.js';

export interface AdbDevice {
  serial: string;
  state: string;
  model: string | null;
}
export type DemoCommand =
  | 'enter'
  | 'clock'
  | 'wifi'
  | 'mobile'
  | 'battery'
  | 'notifications'
  | 'exit';

const DEMO = ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command'];
/** Spec §10.2: constants only after `shell` (the device's shell joins these words). */
const DEMO_ARGS: Record<DemoCommand, string[]> = {
  enter: ['enter'],
  clock: ['clock', '-e', 'hhmm', '0941'],
  wifi: ['network', '-e', 'wifi', 'show', '-e', 'level', '4'],
  mobile: ['network', '-e', 'mobile', 'show', '-e', 'datatype', 'none', '-e', 'level', '4'],
  battery: ['battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
  notifications: ['notifications', '-e', 'visible', 'false'],
  exit: ['exit'],
};
export const DEMO_APPLY: DemoCommand[] = [
  'enter',
  'clock',
  'wifi',
  'mobile',
  'battery',
  'notifications',
];
const SETTING = ['settings', '%', 'global', 'sysui_demo_allowed'];
const setting = (verb: 'get' | 'put' | 'delete') => SETTING.map((w) => (w === '%' ? verb : w));

/** Spec §8: argv after `adb`. The serial only ever follows `-s`. */
export const adb = {
  version: (): string[] => ['version'],
  devices: (): string[] => ['devices', '-l'],
  getprop: (serial: string, prop: 'ro.product.model' | 'ro.build.version.release'): string[] => [
    '-s',
    serial,
    'shell',
    'getprop',
    prop,
  ],
  screencap: (serial: string): string[] => ['-s', serial, 'exec-out', 'screencap', '-p'],
  getDemoAllowed: (serial: string): string[] => ['-s', serial, 'shell', ...setting('get')],
  putDemoAllowed: (serial: string, value: '0' | '1'): string[] => [
    '-s',
    serial,
    'shell',
    ...setting('put'),
    value,
  ],
  deleteDemoAllowed: (serial: string): string[] => ['-s', serial, 'shell', ...setting('delete')],
  demo: (serial: string, command: DemoCommand): string[] => [
    '-s',
    serial,
    'shell',
    ...DEMO,
    ...DEMO_ARGS[command],
  ],
};

export function parseDevices(text: string): AdbDevice[] {
  const out: AdbDevice[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('*') || line.startsWith('List of devices')) continue;
    const m = /^(\S+)\s+(no permissions|\S+)(.*)$/.exec(line);
    if (!m) continue;
    out.push({ serial: m[1], state: m[2], model: /\bmodel:(\S+)/.exec(m[3])?.[1] ?? null });
  }
  return out;
}

const STATE_HINTS: Record<string, string> = {
  unauthorized: 'Unlock the device and accept the "Allow USB debugging" prompt, then run it again.',
  offline: 'Run adb kill-server, then adb devices, and run it again.',
  'no permissions':
    'Fix the udev rules for the device (Linux), run adb kill-server, then run it again.',
};
const notFound = (message: string, state?: string) =>
  new CliError('CAPTURE_DEVICE_NOT_FOUND', message, {
    hint:
      (state && STATE_HINTS[state]) ??
      'Start an emulator (emulator -avd <name>) or plug in a device with USB debugging on.',
  });

/** Spec §8: --serial (or ANDROID_SERIAL), else the only usable device. */
export function pickDevice(list: AdbDevice[], serial: string | undefined): AdbDevice {
  const usable = list.filter((d) => d.state === 'device' && SERIAL.test(d.serial));
  if (serial) {
    const d = list.find((x) => x.serial === serial);
    if (d && usable.includes(d)) return d;
    throw notFound(
      d ? `${serial} is ${d.state}.` : `No device ${serial} (see adb devices).`,
      d?.state,
    );
  }
  if (usable.length === 1) return usable[0];
  if (!usable.length) {
    const first = list[0];
    throw notFound(
      first ? `${first.serial} is ${first.state}.` : 'No Android device or emulator is connected.',
      first?.state,
    );
  }
  throw new CliError(
    'CAPTURE_DEVICE_AMBIGUOUS',
    `${usable.length} Android devices are connected.`,
    {
      details: { devices: usable.map((d) => ({ serial: d.serial, model: d.model })) },
    },
  );
}
