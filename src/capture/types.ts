import type { StatusBarReport } from './statusBar.js';

export interface Target {
  kind: 'simulator' | 'android_device' | 'browser';
  id: string;
  name: string | null;
  os: string | null;
}
/** What a form runner hands back to commands/capture.ts (spec §4). */
export interface PlatformResult {
  tool: { name: 'xcrun' | 'adb' | 'playwright'; path: string; version: string | null };
  target: Target;
  images: Uint8Array[];
  statusBar: StatusBarReport;
  /** The manual restore command when a status bar was changed, else null. */
  manual: string | null;
}
export interface DeviceCaptureOptions {
  /** The real output folder (temp files of simctl go below it). */
  folder: string;
  cleanStatusBar: boolean;
  settleMs: number;
  timeoutMs: number;
}
