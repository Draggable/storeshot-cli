import { describe, expect, it } from 'vitest';
import { captionsText, planCaptions } from '../../src/capture/captionsFile.js';

describe('captions.json plan (spec §11)', () => {
  it('creates a document; placeholders are listed', () => {
    const plan = planCaptions(
      null,
      [{ file: '01-map.png', caption: 'Find' }, { file: '02.png' }],
      'Trailmate',
    );
    expect(plan.doc).toEqual({
      app: { name: 'Trailmate' },
      screens: [
        { file: '01-map.png', caption: 'Find' },
        { file: '02.png', caption: 'Screen 2' },
      ],
    });
    expect(plan.placeholders).toEqual(['02.png']);
    expect(captionsText(plan.doc).endsWith('}\n')).toBe(true);
  });
  it('keeps app, description, featureGraphic and order; updates only given captions', () => {
    const existing = {
      app: { name: 'Old', description: 'Maps' },
      screens: [
        { file: '01.png', caption: 'One' },
        { file: '02.png', caption: 'Two' },
      ],
      featureGraphic: { screen: 1, caption: 'Banner' },
    };
    const plan = planCaptions(
      existing,
      [{ file: '01.png' }, { file: '02.png', caption: 'New' }, { file: '03.png' }],
      'New name',
    );
    expect(plan.doc).toEqual({
      app: { name: 'New name', description: 'Maps' },
      screens: [
        { file: '01.png', caption: 'One' },
        { file: '02.png', caption: 'New' },
        { file: '03.png', caption: 'Screen 3' },
      ],
      featureGraphic: { screen: 1, caption: 'Banner' },
    });
    expect(plan.placeholders).toEqual(['03.png']);
  });
  it('refuses an 11th screen before anything is captured', () => {
    const existing = {
      screens: Array.from({ length: 10 }, (_, i) => ({ file: `${i}.png`, caption: 'c' })),
    };
    expect(() => planCaptions(existing, [{ file: 'x.png' }])).toThrow(/at most 10/);
  });
});
