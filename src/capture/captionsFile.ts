import { validateCaptions, type Captions } from '../captions.js';
import { CliError } from '../errors.js';
import { placeholderCaption } from './naming.js';

export interface ShotCaption {
  file: string;
  caption?: string;
}
export interface CaptionsPlan {
  doc: Captions;
  /** Files whose caption this run made up (spec §11). */
  placeholders: string[];
}

/** Spec §11 (R4): append new files, update only given captions, keep everything else. */
export function planCaptions(
  existing: Captions | null,
  shots: ShotCaption[],
  appName?: string,
): CaptionsPlan {
  const screens = existing ? existing.screens.map((s) => ({ ...s })) : [];
  const placeholders: string[] = [];
  for (const shot of shots) {
    const i = screens.findIndex((s) => s.file === shot.file);
    if (i >= 0) {
      if (shot.caption !== undefined) screens[i].caption = shot.caption;
      continue;
    }
    if (shot.caption === undefined) placeholders.push(shot.file);
    screens.push({
      file: shot.file,
      caption: shot.caption ?? placeholderCaption(shot.file, screens.length + 1),
    });
  }
  if (screens.length > 10) {
    throw new CliError(
      'USAGE',
      `captions.json would list ${screens.length} screens; a set takes at most 10.`,
      {
        hint: 'Remove screens from captions.json, use another --out folder, or pass --no-captions.',
      },
    );
  }
  const app = appName !== undefined ? { ...existing?.app, name: appName } : existing?.app;
  const doc = {
    ...(app ? { app } : {}),
    screens,
    ...(existing?.featureGraphic !== undefined ? { featureGraphic: existing.featureGraphic } : {}),
  };
  return { doc: validateCaptions(doc), placeholders };
}

export const captionsText = (doc: Captions): string => `${JSON.stringify(doc, null, 2)}\n`;
