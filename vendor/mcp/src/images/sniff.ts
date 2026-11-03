/** Spec §9.2: the image types Storeshot accepts, told apart by their magic bytes (pure). */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** PNG, JPEG, WebP; `heic` for HEIC/HEIF (refused with its own message); null otherwise. */
export function sniff(b: Uint8Array): ImageType | 'heic' | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && ascii(b, 4, 8) === '\r\n\x1a\n')
    return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP')
    return 'image/webp';
  if (
    b.length >= 12 &&
    ascii(b, 4, 8) === 'ftyp' &&
    /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(b, 8, 12))
  )
    return 'heic';
  return null;
}
