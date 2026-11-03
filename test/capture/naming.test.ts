import { describe, expect, it } from 'vitest';
import { CAPTION_FILE_NAME } from '../../src/captions.js';
import { countNumbered, nn, placeholderCaption, slugOfRoute } from '../../src/capture/naming.js';

describe('naming (spec §11)', () => {
  it('slugs of routes', () => {
    expect(slugOfRoute('/')).toBe('home');
    expect(slugOfRoute('')).toBe('home');
    expect(slugOfRoute('/settings/Profile')).toBe('settings-profile');
    expect(slugOfRoute('/#/settings')).toBe('settings');
    expect(slugOfRoute('/search?q=trail&x=1')).toBe('searchqtrailx1');
    expect(slugOfRoute(`/${'a'.repeat(80)}`)).toHaveLength(40);
    for (const r of ['/', '/a/b', '/#/x', '/ü/ß'])
      expect(CAPTION_FILE_NAME.test(`01-${slugOfRoute(r)}.png`), r).toBe(true);
  });
  it('numbering', () => {
    expect(nn(3)).toBe('03');
    expect(countNumbered(['01.png', '02-map.png', 'logo.png', '03.jpg', 'captions.json'])).toBe(2);
  });
  it('placeholder captions', () => {
    expect(placeholderCaption('01-map.png', 1)).toBe('Map');
    expect(placeholderCaption('02-trail_detail.png', 2)).toBe('Trail detail');
    expect(placeholderCaption('03.png', 3)).toBe('Screen 3');
  });
});
