import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { McpToolError } from '../errors.js';

const notAllowed = (message: string) =>
  new McpToolError(
    'PATH_NOT_ALLOWED',
    message,
    'Pass an absolute path to a file or folder you own (inside STORESHOT_MCP_ROOT when it is set).',
  );

/** `child` is `parent` or below it (path segments, not string prefixes). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The real path of `target`, or of its deepest existing ancestor joined with the rest. */
function realOrAncestor(target: string): string {
  let current = target;
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...rest);
}

/** Spec §9.1: a path from a tool argument → an absolute path the server may use. */
export function resolveUserPath(input: string, opts: { root: string | null }): string {
  if (!input || input.includes('\0')) throw notAllowed('The path is empty or contains a NUL byte.');
  if (/^\\\\/.test(input) || /^\/\/[^/]/.test(input)) {
    throw notAllowed('Device and network paths are not allowed.');
  }
  let absolute: string;
  if (path.isAbsolute(input)) absolute = path.resolve(input);
  else if (opts.root) absolute = path.resolve(opts.root, input);
  else {
    throw notAllowed(
      `"${input}" is relative: pass an absolute path (the server cannot know your working directory).`,
    );
  }
  if (opts.root && !isInside(opts.root, realOrAncestor(absolute))) {
    throw notAllowed(`${absolute} is outside STORESHOT_MCP_ROOT (${opts.root}).`);
  }
  return absolute;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Spec §9.3: a file name from server data → its path segments, or a throw. */
export function safeRelativeName(name: string): string[] {
  const segments = name.split('/');
  const bad = () =>
    new McpToolError(
      'UNSAFE_ARCHIVE',
      `Refusing the unsafe file name "${name.slice(0, 200)}" from the server.`,
      'Report this to support@storeshot.art with the job id.',
    );
  if (segments.length < 1 || segments.length > 8) throw bad();
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === '.' || s === '..' || s.includes(':')) throw bad();
  }
  return segments;
}
