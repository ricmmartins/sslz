import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadiness, monitorReadiness } from '../src/readiness.js';

const config = { hostname: 'acceptanceacct.blob.core.windows.net' };
const privateAddresses = ['10.2.3.4', '172.20.1.7', '192.168.10.8'];

function setup(overrides = {}) {
  const log = [];
  let storageCalls = 0;
  const readiness = createReadiness({
    config,
    resolveIpv4: async () => privateAddresses,
    verifyStorage: async () => { storageCalls += 1; },
    timeoutMs: 200,
    logger: { error: (entry) => log.push(entry) },
    ...overrides
  });
  return { readiness, log, storageCalls: () => storageCalls };
}

test('becomes ready only after private DNS and successful storage verification', async () => {
  const { readiness, storageCalls } = setup();
  assert.deepEqual(readiness.snapshot(), { status: 'not_ready' });
  assert.equal(await readiness.initialize(), true);
  assert.equal(storageCalls(), 1);
  assert.deepEqual(readiness.snapshot(), { status: 'ready' });
});

test('fails closed for public, mixed, empty, and invalid DNS answers without storage access', async () => {
  for (const addresses of [
    ['8.8.8.8'],
    ['10.0.0.1', '8.8.8.8'],
    [],
    ['10.256.0.1']
  ]) {
    const { readiness, storageCalls } = setup({ resolveIpv4: async () => addresses });
    assert.equal(await readiness.initialize(), false);
    assert.equal(storageCalls(), 0);
    assert.deepEqual(readiness.snapshot(), { status: 'not_ready' });
  }
});

test('sanitizes identity/storage failures and logs only a stable code', async () => {
  const { readiness, log } = setup({
    verifyStorage: async () => {
      throw new Error('SDK response included token=secret and account details');
    }
  });
  assert.equal(await readiness.initialize(), false);
  assert.deepEqual(JSON.parse(log[0]), {
    event: 'startup_check_failed',
    code: 'STARTUP_FAILED'
  });
  assert.equal(log.join('').includes('secret'), false);
});

test('times out a stalled DNS probe and remains not ready', async () => {
  const { readiness } = setup({
    timeoutMs: 10,
    resolveIpv4: () => new Promise(() => {})
  });
  assert.equal(await readiness.initialize(), false);
  assert.equal(readiness.code, 'STARTUP_TIMEOUT');
  assert.deepEqual(readiness.snapshot(), { status: 'not_ready' });
});

test('does not continue to storage if DNS resolves after the timeout', async () => {
  let storageCalls = 0;
  const { readiness } = setup({
    timeoutMs: 10,
    resolveIpv4: () => new Promise((resolve) => setTimeout(() => resolve(privateAddresses), 30)),
    verifyStorage: async () => { storageCalls += 1; }
  });
  assert.equal(await readiness.initialize(), false);
  assert.equal(storageCalls, 0);
});

test('retries failed readiness checks until dependencies recover', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await monitorReadiness({
    initialize: async () => {
      attempts += 1;
      if (attempts === 3) controller.abort();
      return attempts === 3;
    }
  }, { intervalMs: 1, signal: controller.signal });
  assert.equal(attempts, 3);
});

test('continues monitoring after success and fails closed if private DNS changes', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const { readiness, storageCalls } = setup({
    resolveIpv4: async () => {
      attempts += 1;
      if (attempts === 3) controller.abort();
      return attempts === 1 ? privateAddresses : ['8.8.8.8'];
    }
  });
  await monitorReadiness(readiness, { intervalMs: 1, signal: controller.signal });
  assert.equal(attempts, 3);
  assert.equal(storageCalls(), 1);
  assert.deepEqual(readiness.snapshot(), { status: 'not_ready' });
});

test('revalidates blob access after success and recovers after a transient data error', async () => {
  let attempts = 0;
  const { readiness } = setup({
    verifyStorage: async () => {
      if (++attempts === 2) throw new Error('SDK failure with secret');
    }
  });
  assert.equal(await readiness.initialize(), true);
  assert.equal(await readiness.initialize(), false);
  assert.deepEqual(readiness.snapshot(), { status: 'not_ready' });
  assert.equal(await readiness.initialize(), true);
});

test('stops retrying promptly during graceful shutdown', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const retrying = monitorReadiness({
    initialize: async () => { attempts += 1; return false; }
  }, { intervalMs: 1000, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await retrying;
  assert.equal(attempts, 1);
});
