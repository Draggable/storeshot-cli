import type { CommandName } from '../args.js';
import { credits } from './credits.js';
import { devices } from './devices.js';
import { generate } from './generate.js';
import { login } from './login.js';
import { logout } from './logout.js';
import { pull } from './pull.js';
import { schema } from './schema.js';
import { set } from './set.js';
import { status } from './status.js';
import type { Command } from './types.js';
import { whoami } from './whoami.js';

export const COMMAND_RUNNERS: Record<CommandName, Command> = {
  login,
  logout,
  whoami,
  credits,
  devices,
  generate,
  set,
  status,
  pull,
  schema,
};
