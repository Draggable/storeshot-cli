import { StoreshotError, type Storeshot } from '@draggable/storeshot-sdk';
import { bool, int } from '../args.js';
import type { Ctx } from '../context.js';
import { CliError } from '../errors.js';
import type { PendingCode } from '../pending.js';
import { sleepFor } from '../wait.js';
import { CLIENT_NAME } from '../version.js';
import type { CommandResult } from './types.js';

const hhmm = (iso: string) => `${iso.slice(11, 16)} UTC`;
/** The SDK does not export its DevicePoll type: derive it from the method. */
type DevicePoll = Awaited<ReturnType<Storeshot['auth']['pollDeviceToken']>>;

/** RFC 8628 §3.5 as the SDK's linkAccount: +5 s after each slow_down, at least Retry-After. */
export function nextInterval(
  state: { interval: number; wait: number },
  poll: Exclude<DevicePoll, { status: 'approved' }>,
): { interval: number; wait: number } {
  if (poll.status !== 'slow_down') return { interval: state.interval, wait: state.interval };
  const interval = state.interval + 5;
  return { interval, wait: Math.max(interval, poll.retryAfterSeconds ?? 0) };
}

const linked = (
  ctx: Ctx,
  d: { alreadyLinked: boolean; keyId: string | null; scopes: string[]; environment: string },
) => ({
  status: 'linked' as const,
  alreadyLinked: d.alreadyLinked,
  environment: d.environment,
  keyId: d.keyId,
  scopes: d.scopes,
  credentialsFile: ctx.store.file,
  userCode: null,
  verificationUri: null,
  verificationUriComplete: null,
  expiresAt: null,
});

export async function login(ctx: Ctx): Promise<CommandResult> {
  const { config } = ctx;
  if (config.explicitKey) {
    throw new CliError(
      'USAGE',
      `A key is already given (${config.explicitKey.source === 'flag' ? '--api-key' : 'STORESHOT_API_KEY'}): login stores a key of its own.`,
      {
        hint: 'Unset STORESHOT_API_KEY (or drop --api-key) to log in, or keep using that key.',
      },
    );
  }
  const stored = ctx.store.read(config.baseUrl, config.environment);
  if (stored) {
    ctx.out.addSecret(stored.apiKey);
    try {
      await ctx.createClient(stored.apiKey).me({ signal: ctx.signal });
      return {
        data: linked(ctx, {
          alreadyLinked: true,
          keyId: stored.keyId,
          scopes: stored.scopes,
          environment: stored.environment,
        }),
        human: [`Already logged in (${stored.environment} key ${stored.keyId}).`],
      };
    } catch (error) {
      if (!(error instanceof StoreshotError) || error.status !== 401) throw error;
      ctx.store.remove(config.baseUrl, config.environment);
      ctx.out.notice('The stored key was revoked or has expired: linking again.');
    }
  }
  const anonymous = ctx.createClient(null);
  let pending = ctx.pending.read(config.baseUrl, config.environment, ctx.now());
  if (!pending) {
    const started = await anonymous.auth.startDeviceAuthorization(
      { clientName: CLIENT_NAME, environment: config.environment },
      { signal: ctx.signal },
    );
    pending = {
      baseUrl: config.baseUrl,
      environment: config.environment,
      deviceCode: started.deviceCode,
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      verificationUriComplete: started.verificationUriComplete,
      interval: started.interval,
      expiresAt: new Date(ctx.now() + started.expiresIn * 1000).toISOString(),
    };
    ctx.pending.write(pending);
  }
  ctx.out.addSecret(pending.deviceCode);
  const instruction = `To link Storeshot (${config.environment}), open ${pending.verificationUriComplete} and confirm the code ${pending.userCode} (expires ${hhmm(pending.expiresAt)}).`;
  if (bool(ctx.args, 'no-wait')) {
    return {
      data: pendingData(ctx, pending),
      human: [instruction, 'Then run storeshot login again.'],
    };
  }
  ctx.out.notice(instruction);
  return poll(ctx, pending);
}

function pendingData(ctx: Ctx, p: PendingCode) {
  return {
    status: 'pending' as const,
    alreadyLinked: false,
    environment: p.environment,
    keyId: null,
    scopes: [],
    credentialsFile: null,
    userCode: p.userCode,
    verificationUri: p.verificationUri,
    verificationUriComplete: p.verificationUriComplete,
    expiresAt: p.expiresAt,
  };
}

async function poll(ctx: Ctx, p: PendingCode): Promise<CommandResult> {
  const anonymous = ctx.createClient(null);
  const expires = Date.parse(p.expiresAt);
  const timeout = int(ctx.args, 'timeout');
  const deadline = Math.min(expires, timeout ? ctx.now() + timeout * 1000 : expires);
  let state = { interval: p.interval, wait: p.interval };
  for (;;) {
    const left = Math.max(0, Math.round((expires - ctx.now()) / 1000));
    ctx.out.progress(`Waiting for approval (code ${p.userCode}, ${left} s left)`, 'waiting');
    let result: DevicePoll;
    try {
      result = await anonymous.auth.pollDeviceToken(p.deviceCode, { signal: ctx.signal });
    } catch (error) {
      if (error instanceof StoreshotError && error.code.startsWith('DEVICE_')) ctx.pending.clear();
      throw error;
    }
    if (result.status === 'approved') {
      ctx.out.addSecret(result.apiKey);
      ctx.store.write({
        baseUrl: p.baseUrl,
        environment: result.environment,
        apiKey: result.apiKey,
        keyId: result.keyId,
        scopes: result.scopes,
        createdAt: new Date(ctx.now()).toISOString(),
      });
      ctx.pending.clear();
      return {
        data: linked(ctx, {
          alreadyLinked: false,
          keyId: result.keyId,
          scopes: result.scopes,
          environment: result.environment,
        }),
        human: [
          `Logged in: ${result.environment} key ${result.keyId}, stored in ${ctx.store.file}.`,
        ],
      };
    }
    state = nextInterval(state, result);
    if (ctx.now() + state.wait * 1000 > deadline) {
      if (deadline >= expires) {
        ctx.pending.clear();
        throw new StoreshotError({
          code: 'DEVICE_CODE_EXPIRED',
          message: 'The code expired before it was approved.',
        });
      }
      throw new CliError(
        'WAIT_TIMEOUT',
        `Not approved within --timeout; the code ${p.userCode} stays valid until ${hhmm(p.expiresAt)}.`,
        {
          hint: 'Approve it, then run storeshot login again.',
          data: pendingData(ctx, p),
        },
      );
    }
    await sleepFor(state.wait * 1000, ctx.signal);
  }
}
