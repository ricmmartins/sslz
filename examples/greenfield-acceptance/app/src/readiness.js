import { StartupError } from './config.js';

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part, index) => !/^\d{1,3}$/.test(address.split('.')[index]) || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function errorCode(error, signal) {
  if (signal.aborted) return 'STARTUP_TIMEOUT';
  return error instanceof StartupError ? error.code : 'STARTUP_FAILED';
}

export function createReadiness({
  config,
  resolveIpv4,
  verifyStorage,
  timeoutMs = 15000,
  logger = console
}) {
  let ready = false;
  let state = 'INITIALIZING';

  async function initialize() {
    ready = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let rejectOnAbort;
    const abortPromise = new Promise((_, reject) => {
      rejectOnAbort = () => reject(new StartupError('STARTUP_TIMEOUT'));
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });

    try {
      if (!config) throw new StartupError('CONFIG_INVALID');

      const addresses = await Promise.race([resolveIpv4(config.hostname), abortPromise]);
      if (controller.signal.aborted) throw new StartupError('STARTUP_TIMEOUT');
      if (!Array.isArray(addresses) || addresses.length === 0 || !addresses.every(isPrivateIpv4)) {
        throw new StartupError('PRIVATE_DNS_REQUIRED');
      }

      await Promise.race([
        verifyStorage({ config, signal: controller.signal }),
        abortPromise
      ]);
      if (controller.signal.aborted) throw new StartupError('STARTUP_TIMEOUT');
      ready = true;
      state = 'READY';
    } catch (error) {
      ready = false;
      state = errorCode(error, controller.signal);
      logger.error(JSON.stringify({ event: 'startup_check_failed', code: state }));
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', rejectOnAbort);
    }

    return ready;
  }

  return {
    initialize,
    snapshot() {
      return ready ? { status: 'ready' } : { status: 'not_ready' };
    },
    get code() {
      return state;
    }
  };
}

export async function monitorReadiness(readiness, { signal, intervalMs = 5000 } = {}) {
  while (!signal?.aborted) {
    await readiness.initialize();
    if (signal?.aborted) break;

    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, intervalMs);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
