import type { Schemas } from '@draggable/storeshot-sdk';
import { isStore, type Store } from './commands/devices.js';
import { CliError } from './errors.js';

export type FeatureGraphic = boolean | { screen: number; caption?: string };
export interface StoreTarget {
  store: Store;
  devices?: string[];
  featureGraphic?: FeatureGraphic;
}

/** Spec §8.7: flat --devices → per-store targets, checked against GET /devices. */
export function planStores(
  input: { stores: string[]; devices: string[]; featureGraphic?: FeatureGraphic },
  catalogue: Schemas['Device'][],
): { stores: StoreTarget[]; warnings: string[] } {
  const warnings: string[] = [];
  for (const s of input.stores)
    if (!isStore(s))
      throw new CliError('USAGE', `Unknown store "${s}": use app_store or google_play.`);
  const byId = new Map(catalogue.map((d) => [d.id, d]));
  const perStore = new Map<Store, string[]>();
  for (const id of input.devices) {
    const d = byId.get(id);
    if (!d) {
      const near = catalogue
        .filter((c) => c.id.startsWith(id.split('_').slice(0, 2).join('_')))
        .map((c) => c.id)
        .slice(0, 5);
      throw new CliError(
        'USAGE',
        `Unknown device "${id}".${near.length ? ` Did you mean ${near.join(', ')}?` : ''}`,
        { hint: 'storeshot devices lists the ids.' },
      );
    }
    if (input.stores.length && !input.stores.includes(d.store)) {
      throw new CliError(
        'USAGE',
        `${id} is a ${d.store} size but --store is ${input.stores.join(',')}.`,
      );
    }
    if (d.deprecated) warnings.push(`${id} is deprecated: use ${d.replacedBy}.`);
    perStore.set(d.store, [...(perStore.get(d.store) ?? []), id]);
  }
  const stores = (input.stores.length ? (input.stores as Store[]) : [...perStore.keys()]).filter(
    (s, i, a) => a.indexOf(s) === i,
  );
  if (!stores.length)
    throw new CliError('USAGE', 'Pass --store (app_store, google_play or both) or --devices.');
  if (input.featureGraphic && !stores.includes('google_play')) {
    throw new CliError(
      'USAGE',
      'The feature graphic is a Google Play image: add --store google_play.',
    );
  }
  return {
    warnings,
    stores: stores.map((store) => {
      const devices = perStore.get(store);
      if (devices && devices.length > 5)
        throw new CliError(
          'USAGE',
          `At most 5 devices per store (${store} has ${devices.length}).`,
        );
      return {
        store,
        ...(devices ? { devices } : {}),
        ...(store === 'google_play' && input.featureGraphic
          ? { featureGraphic: input.featureGraphic }
          : {}),
      };
    }),
  };
}
