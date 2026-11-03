import { CliError } from '../errors.js';
import { UDID } from './forms.js';

export interface Simulator {
  udid: string;
  name: string;
  os: string | null;
}

/** Spec §7, §10.1: argv after `xcrun`. Always an explicit UDID, never `booted`. */
export const simctl = {
  listBooted: (): string[] => ['simctl', 'list', 'devices', 'booted', '-j'],
  screenshot: (udid: string, file: string): string[] => [
    'simctl',
    'io',
    udid,
    'screenshot',
    '--type=png',
    '--mask=ignored',
    file,
  ],
  statusBarOverride: (udid: string): string[] => [
    'simctl',
    'status_bar',
    udid,
    'override',
    '--time',
    '9:41',
    '--dataNetwork',
    'wifi',
    '--wifiMode',
    'active',
    '--wifiBars',
    '3',
    '--cellularMode',
    'active',
    '--cellularBars',
    '4',
    '--operatorName',
    '',
    '--batteryState',
    'charged',
    '--batteryLevel',
    '100',
  ],
  statusBarClear: (udid: string): string[] => ['simctl', 'status_bar', udid, 'clear'],
};

/** xcrun from the command line tools only (no Xcode). */
export const SIMCTL_MISSING = /unable to find utility "simctl"/i;

const RUNTIME = /\.SimRuntime\.(iOS|watchOS|tvOS|xrOS|visionOS)-(\d+)-(\d+)/;

/** `simctl list devices booted -j` → booted iPhone/iPad simulators and the others. */
export function parseBooted(json: string): { ios: Simulator[]; other: Simulator[] } {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new CliError('CAPTURE_FAILED', 'xcrun simctl list did not return JSON.');
  }
  const devices = (doc as { devices?: unknown } | null)?.devices;
  if (!devices || typeof devices !== 'object')
    throw new CliError('CAPTURE_FAILED', 'xcrun simctl list returned no "devices".');
  const ios: Simulator[] = [];
  const other: Simulator[] = [];
  for (const [runtime, list] of Object.entries(devices as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const m = RUNTIME.exec(runtime);
    for (const d of list as { udid?: unknown; name?: unknown; state?: unknown }[]) {
      if (d?.state !== 'Booted' || typeof d.udid !== 'string' || !UDID.test(d.udid)) continue;
      const sim = {
        udid: d.udid,
        name: typeof d.name === 'string' ? d.name : 'Simulator',
        os: m ? `${m[1]} ${m[2]}.${m[3]}` : null,
      };
      (m?.[1] === 'iOS' ? ios : other).push(sim);
    }
  }
  return { ios, other };
}

export function pickSimulator(
  found: { ios: Simulator[]; other: Simulator[] },
  udid?: string,
): Simulator {
  const same = (s: Simulator) => s.udid.toUpperCase() === udid?.toUpperCase();
  if (udid) {
    const sim = found.ios.find(same);
    if (sim) return sim;
    if (found.other.some(same))
      throw new CliError('USAGE', `${udid} is not an iPhone or iPad simulator.`);
    throw new CliError('CAPTURE_DEVICE_NOT_FOUND', `No booted simulator ${udid}.`, {
      hint: `Boot it: xcrun simctl boot ${udid} (or open -a Simulator).`,
    });
  }
  if (found.ios.length === 1) return found.ios[0];
  if (!found.ios.length) {
    throw new CliError(
      'CAPTURE_DEVICE_NOT_FOUND',
      found.other.length
        ? 'No booted iPhone or iPad simulator (only watch, TV or Vision simulators).'
        : 'No booted iOS simulator.',
      { hint: 'Boot one: open -a Simulator, or xcrun simctl boot "iPhone 16 Pro".' },
    );
  }
  throw new CliError('CAPTURE_DEVICE_AMBIGUOUS', `${found.ios.length} simulators are booted.`, {
    details: { devices: found.ios },
  });
}
