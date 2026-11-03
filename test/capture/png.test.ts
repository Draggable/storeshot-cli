import { describe, expect, it } from 'vitest';
import { checkCapture, pngInfo } from '../../src/capture/png.js';
import { MIN_ASPECT, screenshotVerdict } from '../../src/capture/screenshotRules.js';
import { makePng } from './shims/png.mjs';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('png (SS-023 spec §6.4)', () => {
  it('reads the IHDR size', () => {
    expect(pngInfo(makePng(1206, 2622))).toEqual({ width: 1206, height: 2622 });
  });
  it('refuses non-PNG and truncated bytes', () => {
    expect(pngInfo(Buffer.from('hello'))).toBeNull();
    expect(pngInfo(makePng(400, 800).subarray(0, 20))).toBeNull();
    expect(pngInfo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
  it('checkCapture: ok, not a PNG, not a screenshot, too large', () => {
    expect(checkCapture(makePng(1206, 2622), 'xcrun')).toEqual({ width: 1206, height: 2622 });
    expect(codeOf(() => checkCapture(Buffer.from('hello'), 'xcrun'))).toBe('CAPTURE_FAILED');
    expect(codeOf(() => checkCapture(makePng(2000, 200), 'adb'))).toBe('NOT_A_SCREENSHOT');
    expect(codeOf(() => checkCapture(makePng(200, 400), 'adb'))).toBe('NOT_A_SCREENSHOT');
    const big = makePng(400, 800);
    big.writeUInt32BE(17000, 16); // a forged IHDR width: the limit check needs no decode
    expect(codeOf(() => checkCapture(big, 'adb'))).toBe('IMAGE_TOO_LARGE');
  });
  it('the verdicts', () => {
    expect(screenshotVerdict({ width: 1179, height: 2556 })).toEqual({ ok: true });
    expect(screenshotVerdict({ width: 3024, height: 4032 })).toMatchObject({ reason: 'too_large' });
    expect(screenshotVerdict({ width: 299, height: 600 })).toMatchObject({ reason: 'too_small' });
    expect(screenshotVerdict({ width: 400, height: 1200 })).toMatchObject({ reason: 'aspect' });
    expect(MIN_ASPECT).toBeCloseTo(0.396, 6);
  });
});
