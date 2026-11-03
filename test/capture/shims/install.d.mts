export interface ShimCall {
  tool: 'xcrun' | 'adb' | 'maestro';
  argv: string[];
  env: Record<string, string>;
  cwd: string;
}
export interface Shims {
  dir: string;
  bin: string;
  env: Record<string, string>;
  calls(): ShimCall[];
  cleanup(): void;
}
export function installShims(opts?: { png?: Buffer; scenario?: string[] }): Shims;
