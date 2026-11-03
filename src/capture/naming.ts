export const nn = (n: number): string => String(n).padStart(2, '0');

/** Spec §11: `/settings/Profile` → `settings-profile`; `/` → `home`; ≤ 40 characters. */
export function slugOfRoute(route: string): string {
  const slug = route
    .toLowerCase()
    .replace(/[/#]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return slug || 'home';
}

/** PNGs that already carry a two-digit number (numbering without captions.json). */
export const countNumbered = (files: string[]): number =>
  files.filter((f) => /^\d{2}[-.]/.test(f) && /\.png$/i.test(f)).length;

/** Spec §11: `01-map.png` → `Map`; `03.png` → `Screen 3`. */
export function placeholderCaption(file: string, position: number): string {
  const words = file
    .replace(/\.png$/i, '')
    .replace(/^\d+[-_.]?/, '')
    .split(/[-_.]+/)
    .filter(Boolean);
  if (!words.length) return `Screen ${position}`;
  const text = words.join(' ');
  return text[0].toUpperCase() + text.slice(1);
}
