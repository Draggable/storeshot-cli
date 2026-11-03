import {
  StoreshotError,
  type Generation,
  type ScreenshotSet,
  type Storeshot,
} from '@draggable/storeshot-sdk';

export type Job =
  | { kind: 'generation'; value: Generation }
  | { kind: 'screenshot_set'; value: ScreenshotSet };

/** The MCP server's rule (spec §8.3): without a kind, a set first, then a generation on 404. */
export async function fetchJob(
  client: Storeshot,
  id: string,
  kind: Job['kind'] | undefined,
  signal: AbortSignal,
): Promise<Job> {
  if (kind !== 'generation') {
    try {
      return { kind: 'screenshot_set', value: await client.screenshotSets.get(id, { signal }) };
    } catch (error) {
      const notFound = error instanceof StoreshotError && error.status === 404;
      if (kind === 'screenshot_set' || !notFound) throw error;
    }
  }
  return { kind: 'generation', value: await client.generations.get(id, { signal }) };
}
