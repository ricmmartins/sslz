import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAzureStorage } from '../src/azure-storage.js';

const config = {
  clientId: '12345678-1234-4234-8234-123456789abc',
  accountUrl: 'https://acceptanceacct.blob.core.windows.net',
  container: 'acceptance'
};

function adapters({ token = 'simulated-token', mismatch = false, tokenError, dataError } = {}) {
  const calls = [];
  let written;
  const credential = {
    async getToken(scope, options) {
      calls.push({ operation: 'token', scope, signal: options.abortSignal });
      if (tokenError) throw tokenError;
      return { token };
    }
  };
  return {
    calls,
    createCredential(clientId) {
      assert.equal(clientId, config.clientId);
      return credential;
    },
    createBlobService(accountUrl, suppliedCredential) {
      assert.equal(accountUrl, config.accountUrl);
      assert.equal(suppliedCredential, credential);
      return {
        getContainerClient(container) {
          assert.equal(container, 'acceptance');
          return {
            getBlockBlobClient(blobName) {
              assert.equal(blobName, '_sslz-acceptance-canary');
              return {
                async uploadData(content, options) {
                  calls.push({ operation: 'write', signal: options.abortSignal });
                  if (dataError) throw dataError;
                  written = Buffer.from(content);
                },
                async downloadToBuffer(_offset, _count, options) {
                  calls.push({ operation: 'read', signal: options.abortSignal });
                  return mismatch ? Buffer.from('wrong content') : written;
                }
              };
            }
          };
        }
      };
    }
  };
}

test('requires the selected identity token, canary write, and exact readback', async () => {
  const dependencies = adapters();
  const signal = new AbortController().signal;
  await verifyAzureStorage({ config, signal }, dependencies);
  assert.deepEqual(dependencies.calls.map((call) => call.operation), ['token', 'write', 'read']);
  assert.equal(dependencies.calls[0].scope, 'https://storage.azure.com/.default');
  assert.equal(dependencies.calls.every((call) => call.signal === signal), true);
});

test('fails closed on absent tokens and mismatched data', async () => {
  for (const [options, code] of [
    [{ token: '' }, 'IDENTITY_CHECK_FAILED'],
    [{ mismatch: true }, 'BLOB_READBACK_MISMATCH']
  ]) {
    await assert.rejects(verifyAzureStorage({ config }, adapters(options)), { code });
  }
});

test('never touches data after an identity failure and propagates data failures', async () => {
  const tokenFailure = adapters({ tokenError: new Error('simulated identity failure') });
  await assert.rejects(verifyAzureStorage({ config }, tokenFailure));
  assert.deepEqual(tokenFailure.calls.map((call) => call.operation), ['token']);
  await assert.rejects(
    verifyAzureStorage({ config }, adapters({ dataError: new Error('simulated data failure') }))
  );
});
