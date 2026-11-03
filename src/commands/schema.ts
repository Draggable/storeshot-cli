import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import { SCHEMAS } from '../jsonSchemas.js';
import type { CommandResult } from './types.js';

/** Prints a JSON Schema (offline, no key): the one raw-JSON exception to the envelope. */
export async function schema(ctx: Ctx): Promise<CommandResult> {
  const name = ctx.args.positionals[0] ?? 'index';
  const found = SCHEMAS[name];
  if (!found)
    throw new CliError(
      'USAGE',
      `No schema "${name}". Schemas: ${Object.keys(SCHEMAS).join(', ')}.`,
    );
  return { data: null, human: [], raw: `${JSON.stringify(found, null, 2)}\n` };
}
