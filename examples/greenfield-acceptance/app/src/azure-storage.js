import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { StartupError } from './config.js';

const CANARY_BLOB = '_sslz-acceptance-canary';
const CANARY_CONTENT = Buffer.from('sslz-acceptance-canary-v1', 'utf8');

export async function verifyAzureStorage(
  { config, signal },
  {
    createCredential = (clientId) => new ManagedIdentityCredential(clientId),
    createBlobService = (accountUrl, credential) => new BlobServiceClient(accountUrl, credential)
  } = {}
) {
  const credential = createCredential(config.clientId);
  const token = await credential.getToken('https://storage.azure.com/.default', {
    abortSignal: signal
  });
  if (!token?.token) throw new StartupError('IDENTITY_CHECK_FAILED');

  const service = createBlobService(config.accountUrl, credential);
  const blob = service
    .getContainerClient(config.container)
    .getBlockBlobClient(CANARY_BLOB);

  await blob.uploadData(CANARY_CONTENT, {
    abortSignal: signal,
    blobHTTPHeaders: { blobContentType: 'text/plain' }
  });
  const readback = await blob.downloadToBuffer(undefined, undefined, {
    abortSignal: signal
  });

  if (!readback.equals(CANARY_CONTENT)) {
    throw new StartupError('BLOB_READBACK_MISMATCH');
  }
}
