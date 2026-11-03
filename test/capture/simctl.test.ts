import { describe, expect, it } from 'vitest';
import { parseBooted, pickSimulator, simctl } from '../../src/capture/simctl.js';

const U1 = 'AAAAAAAA-1111-4111-8111-111111111111';
const U2 = 'BBBBBBBB-2222-4222-8222-222222222222';
const json = (devices: Record<string, unknown[]>) => JSON.stringify({ devices });
const booted = (udid: string, name: string) => ({ udid, name, state: 'Booted' });
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('simctl (spec §7)', () => {
  it('argv builders are exact and never use "booted"', () => {
    expect(simctl.listBooted()).toEqual(['simctl', 'list', 'devices', 'booted', '-j']);
    expect(simctl.screenshot(U1, '/o/.storeshot-capture-x/shot.png')).toEqual([
      'simctl',
      'io',
      U1,
      'screenshot',
      '--type=png',
      '--mask=ignored',
      '/o/.storeshot-capture-x/shot.png',
    ]);
    expect(simctl.statusBarOverride(U1)).toEqual([
      'simctl',
      'status_bar',
      U1,
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
    ]);
    expect(simctl.statusBarClear(U1)).toEqual(['simctl', 'status_bar', U1, 'clear']);
  });
  it('parseBooted: iOS only, runtime label, shutdown and bad udids ignored', () => {
    const found = parseBooted(
      json({
        'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
          booted(U1, 'iPhone 16 Pro'),
          { udid: U2, name: 'Off', state: 'Shutdown' },
          booted('not-a-udid', 'Bad'),
        ],
        'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [booted(U2, 'Apple Watch')],
      }),
    );
    expect(found.ios).toEqual([{ udid: U1, name: 'iPhone 16 Pro', os: 'iOS 18.2' }]);
    expect(found.other).toEqual([{ udid: U2, name: 'Apple Watch', os: 'watchOS 11.0' }]);
    expect(codeOf(() => parseBooted('== Devices =='))).toBe('CAPTURE_FAILED');
  });
  it('pickSimulator: one, none, several, a given udid, a watch udid', () => {
    const one = parseBooted(json({ 'x.SimRuntime.iOS-18-2': [booted(U1, 'iPhone')] }));
    expect(pickSimulator(one).udid).toBe(U1);
    expect(pickSimulator(one, U1.toLowerCase()).udid).toBe(U1);
    expect(codeOf(() => pickSimulator(one, U2))).toBe('CAPTURE_DEVICE_NOT_FOUND');
    expect(codeOf(() => pickSimulator({ ios: [], other: [] }))).toBe('CAPTURE_DEVICE_NOT_FOUND');
    const two = parseBooted(json({ 'x.SimRuntime.iOS-18-2': [booted(U1, 'a'), booted(U2, 'b')] }));
    expect(codeOf(() => pickSimulator(two))).toBe('CAPTURE_DEVICE_AMBIGUOUS');
    const watch = parseBooted(json({ 'x.SimRuntime.watchOS-11-0': [booted(U2, 'w')] }));
    expect(codeOf(() => pickSimulator(watch, U2))).toBe('USAGE');
  });
});
