import type { Ctx } from '../context.js';

/** A command's success: `data` + human lines, or `raw` text (help-like output, spec §8.8). */
export interface CommandResult {
  data: unknown;
  human: string[];
  raw?: string;
}
export type Command = (ctx: Ctx) => Promise<CommandResult>;
