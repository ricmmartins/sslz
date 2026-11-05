import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';

const valid = {
  AZURE_CLIENT_ID: '12345678-1234-4234-8234-123456789abc',
  BLOB_ACCOUNT_URL: 'https://acceptanceacct.blob.core.windows.net',
  BLOB_CONTAINER: 'acceptance'
};

test('parses the required bounded workload configuration', () => {
  assert.deepEqual(parseConfig(valid), {
    clientId: valid.AZURE_CLIENT_ID,
    accountUrl: valid.BLOB_ACCOUNT_URL,
    container: 'acceptance',
    hostname: 'acceptanceacct.blob.core.windows.net',
    port: 8080
  });
});

test('rejects missing, invalid, public, or non-fixed configuration', () => {
  for (const changes of [
    { AZURE_CLIENT_ID: '' },
    { BLOB_ACCOUNT_URL: 'http://acceptanceacct.blob.core.windows.net' },
    { BLOB_ACCOUNT_URL: 'https://example.com' },
    { BLOB_ACCOUNT_URL: 'https://user:pass@acceptanceacct.blob.core.windows.net' },
    { BLOB_ACCOUNT_URL: 'https://acceptanceacct.blob.core.windows.net/container' },
    { BLOB_CONTAINER: 'other' },
    { PORT: '70000' }
  ]) {
    assert.throws(() => parseConfig({ ...valid, ...changes }), { code: 'CONFIG_INVALID' });
  }
});
