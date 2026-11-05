import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHttpServer } from '../src/server.js';

async function withServer(readiness, run) {
  const server = createHttpServer(readiness);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('serves liveness and readiness, and rejects all other routes', async () => {
  let ready = false;
  await withServer(
    { snapshot: () => ready ? { status: 'ready' } : { status: 'not_ready' } },
    async (origin) => {
      const health = await fetch(`${origin}/healthz`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: 'ok' });

      const initialReadiness = await fetch(`${origin}/readyz`);
      assert.equal(initialReadiness.status, 503);
      assert.deepEqual(await initialReadiness.json(), { status: 'not_ready' });

      ready = true;
      const readyResponse = await fetch(`${origin}/readyz`);
      assert.equal(readyResponse.status, 200);
      assert.deepEqual(await readyResponse.json(), { status: 'ready' });

      assert.equal((await fetch(`${origin}/write`, { method: 'POST' })).status, 405);
      assert.equal((await fetch(`${origin}/other`)).status, 404);
    }
  );
});
