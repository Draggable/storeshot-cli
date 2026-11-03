// SS-023 spec §6.4: the server's screenshot geometry rules (packages/shared/src/
// screenshotDimensions.ts), checked before anything is written, so a capture the API would refuse
// fails here. Pinned by test/monorepo/screenshotRulesParity.test.ts.
export const MIN_SHORT_EDGE = 300;
export const MAX_SHORT_EDGE = 2600;
/** The narrowest known device (1080 × 2400) less the shared 12 % tolerance (MIN_KNOWN_ASPECT). */
export const MIN_ASPECT = (1080 / 2400) * (1 - 0.12);

export type Verdict =
  | { ok: true }
  | { ok: false; reason: 'too_large' | 'too_small' | 'aspect'; message: string };

export function screenshotVerdict(d: { width: number; height: number }): Verdict {
  const short = Math.min(d.width, d.height);
  const size = `${d.width}x${d.height}`;
  if (short > MAX_SHORT_EDGE)
    return {
      ok: false,
      reason: 'too_large',
      message: `The capture (${size}) has a short edge above ${MAX_SHORT_EDGE} px: Storeshot would refuse it as a photo.`,
    };
  if (short < MIN_SHORT_EDGE)
    return {
      ok: false,
      reason: 'too_small',
      message: `The capture (${size}) has a short edge below ${MIN_SHORT_EDGE} px: Storeshot would refuse it.`,
    };
  if (short / Math.max(d.width, d.height) < MIN_ASPECT)
    return {
      ok: false,
      reason: 'aspect',
      message: `The capture (${size}) is too long and thin to be a screen: Storeshot would refuse it.`,
    };
  return { ok: true };
}
