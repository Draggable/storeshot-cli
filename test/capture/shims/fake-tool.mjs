// One fake for xcrun, adb and maestro (SS-023 spec §16.2). argv[2] is the tool name (set by the sh
// wrapper). Every call appends { tool, argv, env, cwd } to $FAKE_TOOL_LOG. Behaviour comes from
// $FAKE_TOOL_SCENARIO (comma list). Screenshots are the bytes of $FAKE_PNG.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [tool, ...argv] = process.argv.slice(2);
const scenario = new Set((process.env.FAKE_TOOL_SCENARIO ?? '').split(',').filter(Boolean));
appendFileSync(
  process.env.FAKE_TOOL_LOG,
  `${JSON.stringify({ tool, argv, env: process.env, cwd: process.cwd() })}\n`,
);
const png = () => readFileSync(process.env.FAKE_PNG);
const fail = (message, code = 1) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};
const hang = () => setInterval(() => {}, 1000);
const UDID_1 = 'AAAAAAAA-1111-4111-8111-111111111111';
const UDID_2 = 'BBBBBBBB-2222-4222-8222-222222222222';
const sim = (udid, name) => ({ udid, name, state: 'Booted', isAvailable: true });

function xcrun() {
  if (scenario.has('simctl-missing'))
    fail('xcrun: error: unable to find utility "simctl", not a developer tool or in PATH', 72);
  const [sub, ...rest] = argv.slice(1);
  if (sub === 'list') {
    if (scenario.has('list-not-json')) return process.stdout.write('== Devices ==\n');
    const devices = {};
    if (!scenario.has('none')) {
      const ios = [sim(UDID_1, 'iPhone 16 Pro')];
      if (scenario.has('two-booted')) ios.push(sim(UDID_2, 'iPad Air 11-inch (M2)'));
      devices['com.apple.CoreSimulator.SimRuntime.iOS-18-2'] = ios;
      if (scenario.has('watch'))
        devices['com.apple.CoreSimulator.SimRuntime.watchOS-11-0'] = [sim(UDID_2, 'Apple Watch')];
    }
    return process.stdout.write(JSON.stringify({ devices }));
  }
  if (sub === 'io') {
    if (scenario.has('screenshot-hangs')) return hang();
    if (scenario.has('screenshot-fails'))
      fail('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=5)');
    const file = rest.at(-1);
    writeFileSync(file, scenario.has('not-png') ? Buffer.from('hello') : png());
    return process.stdout.write(`Wrote screenshot to: ${file}\n`);
  }
  if (sub === 'status_bar') {
    const action = rest[1];
    if (action === 'override' && scenario.has('override-fails')) fail('Failed to override');
    if (action === 'clear' && scenario.has('restore-fails')) fail('Failed to clear');
    return;
  }
  fail(`fake xcrun: unhandled ${argv.join(' ')}`);
}

function adb() {
  if (argv[0] === 'version')
    return process.stdout.write('Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458\n');
  if (argv[0] === 'devices') {
    const lines = ['List of devices attached'];
    if (scenario.has('adb-unauthorized'))
      lines.push('R58M123ABC     unauthorized usb:1-1 transport_id:2');
    else if (!scenario.has('none'))
      lines.push(
        'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1',
      );
    if (scenario.has('two-devices'))
      lines.push(
        'emulator-5556          device product:sdk model:Pixel_Tablet device:tangor transport_id:3',
      );
    return process.stdout.write(`${lines.join('\n')}\n\n`);
  }
  // -s <serial> …
  const rest = argv[0] === '-s' ? argv.slice(2) : argv;
  if (rest[0] === 'exec-out' && rest[1] === 'screencap') {
    if (scenario.has('screencap-hangs')) return hang();
    if (scenario.has('huge-stdout')) {
      const block = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < 70; i += 1) process.stdout.write(block);
      return;
    }
    return process.stdout.write(scenario.has('not-png') ? Buffer.from('hello') : png());
  }
  if (rest[0] === 'shell') {
    const cmd = rest.slice(1);
    if (cmd[0] === 'getprop')
      return process.stdout.write(cmd[1] === 'ro.product.model' ? 'Pixel 8\n' : '15\n');
    if (cmd[0] === 'settings' && cmd[1] === 'get') {
      const v = scenario.has('demo-0') ? '0' : scenario.has('demo-1') ? '1' : 'null';
      return process.stdout.write(`${v}\n`);
    }
    if (cmd[0] === 'settings') return;
    if (cmd[0] === 'am') {
      const command = cmd[cmd.indexOf('command') + 1];
      if (command === 'exit' && scenario.has('restore-fails')) fail('Broadcast failed');
      if (command !== 'exit' && scenario.has('override-fails')) fail('Broadcast failed');
      return process.stdout.write(
        'Broadcasting: Intent { act=com.android.systemui.demo }\nBroadcast completed: result=0\n',
      );
    }
  }
  fail(`fake adb: unhandled ${argv.join(' ')}`);
}

function maestro() {
  const outIndex = argv.indexOf('--test-output-dir');
  const out = outIndex >= 0 ? argv[outIndex + 1] : process.cwd();
  const flow = argv.at(-1);
  const dir = path.join(out, 'run-1', 'takeScreenshot');
  mkdirSync(dir, { recursive: true });
  for (const m of readFileSync(flow, 'utf8').matchAll(/takeScreenshot:\s*(\S+)/g))
    writeFileSync(path.join(dir, `${m[1]}.png`), png());
}

({ xcrun, adb, maestro })[tool]();
