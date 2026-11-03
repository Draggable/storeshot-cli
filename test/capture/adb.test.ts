import { describe, expect, it } from 'vitest';
import { DEMO_APPLY, adb, parseDevices, pickDevice } from '../../src/capture/adb.js';

const LIST = [
  '* daemon not running; starting now at tcp:5037',
  'List of devices attached',
  'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 transport_id:1',
  'R58M123ABC             unauthorized usb:1-1 transport_id:2',
  '0123456789ABCDEF       no permissions (missing udev rules?); see [http://developer.android.com/tools/device.html]',
  'adb-R58M._adb-tls-connect._tcp device product:p model:Pixel_8 transport_id:4',
  '',
].join('\n');
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('adb (spec §8, §10.2)', () => {
  it('parseDevices: states, models, daemon lines', () => {
    expect(parseDevices(LIST)).toEqual([
      { serial: 'emulator-5554', state: 'device', model: 'sdk_gphone64_x86_64' },
      { serial: 'R58M123ABC', state: 'unauthorized', model: null },
      { serial: '0123456789ABCDEF', state: 'no permissions', model: null },
      { serial: 'adb-R58M._adb-tls-connect._tcp', state: 'device', model: 'Pixel_8' },
    ]);
  });
  it('pickDevice: explicit, automatic, ambiguous, not usable', () => {
    const all = parseDevices(LIST);
    expect(pickDevice(all, 'emulator-5554').serial).toBe('emulator-5554');
    expect(codeOf(() => pickDevice(all, 'R58M123ABC'))).toBe('CAPTURE_DEVICE_NOT_FOUND');
    expect(codeOf(() => pickDevice(all, 'nope'))).toBe('CAPTURE_DEVICE_NOT_FOUND');
    expect(codeOf(() => pickDevice(all, undefined))).toBe('CAPTURE_DEVICE_AMBIGUOUS');
    expect(pickDevice(all.slice(0, 3), undefined).serial).toBe('emulator-5554');
    expect(codeOf(() => pickDevice([], undefined))).toBe('CAPTURE_DEVICE_NOT_FOUND');
  });
  it('pickDevice: a reported serial that fails the serial rule is never used', () => {
    expect(
      codeOf(() => pickDevice([{ serial: '-oops', state: 'device', model: null }], undefined)),
    ).toBe('CAPTURE_DEVICE_NOT_FOUND');
  });
  it('argv builders are exact', () => {
    expect(adb.devices()).toEqual(['devices', '-l']);
    expect(adb.screencap('emulator-5554')).toEqual([
      '-s',
      'emulator-5554',
      'exec-out',
      'screencap',
      '-p',
    ]);
    expect(adb.demo('emulator-5554', 'clock')).toEqual([
      '-s',
      'emulator-5554',
      'shell',
      'am',
      'broadcast',
      '-a',
      'com.android.systemui.demo',
      '-e',
      'command',
      'clock',
      '-e',
      'hhmm',
      '0941',
    ]);
    expect(DEMO_APPLY).toEqual(['enter', 'clock', 'wifi', 'mobile', 'battery', 'notifications']);
  });
  it('no caller value ever follows "shell" (the device shell joins those words)', () => {
    for (const serial of ['emulator-5554', 'x;rm -rf /', '$(id)']) {
      const all = [
        adb.getprop(serial, 'ro.product.model'),
        adb.getprop(serial, 'ro.build.version.release'),
        adb.getDemoAllowed(serial),
        adb.putDemoAllowed(serial, '1'),
        adb.putDemoAllowed(serial, '0'),
        adb.deleteDemoAllowed(serial),
        ...DEMO_APPLY.map((c) => adb.demo(serial, c)),
        adb.demo(serial, 'exit'),
      ];
      for (const args of all) {
        const shell = args.indexOf('shell');
        expect(args.slice(0, shell)).toEqual(['-s', serial]);
        expect(args.slice(shell + 1)).not.toContain(serial);
      }
    }
  });
});
