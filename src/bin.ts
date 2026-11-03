#!/usr/bin/env node
// storeshot: the Storeshot CLI. No logic here: a Node version guard, signals, then main(). The
// namespace import keeps an older Node from failing at link time before the guard can explain.
import * as readline from 'node:readline';
import * as util from 'node:util';

if (typeof util.parseArgs !== 'function') {
  process.stderr.write('storeshot needs Node.js 18.3 or later.\n');
  process.exit(2);
}

type SignalName = 'SIGINT' | 'SIGTERM';
const controller = new AbortController();
let signalName: SignalName | null = null;
/** Spec §9: the first signal aborts (cleanup, one result); a second one exits at once. */
const onSignal = (name: SignalName) => () => {
  if (signalName) process.exit(name === 'SIGTERM' ? 143 : 130);
  signalName = name;
  controller.abort(new Error(name));
};
process.on('SIGINT', onSignal('SIGINT'));
process.on('SIGTERM', onSignal('SIGTERM'));

/** The spend confirmation (spec §10): EOF or Ctrl-C answers null. */
function prompt(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    let done = false;
    const finish = (answer: string | null) => {
      if (done) return;
      done = true;
      rl.close();
      resolve(answer);
    };
    rl.on('close', () => finish(null));
    rl.on('SIGINT', () => {
      onSignal('SIGINT')();
      finish(null);
    });
    rl.question(question, (answer) => finish(answer));
  });
}

const { main } = await import('./main.js');
const code = await main(process.argv.slice(2), {
  streams: { stdout: process.stdout, stderr: process.stderr },
  env: process.env,
  signal: controller.signal,
  signalName: () => signalName,
  stdinIsTTY: Boolean(process.stdin.isTTY),
  cwd: process.cwd(),
  prompt,
});
process.exitCode = code;
// Flush stdout (a pipe may still hold the JSON document), then exit even if a socket lingers.
process.stdout.write('', () => process.exit(code));
