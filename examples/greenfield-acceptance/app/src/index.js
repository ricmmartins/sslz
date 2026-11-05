import { resolve4 } from 'node:dns/promises';
import { parseConfig } from './config.js';
import { verifyAzureStorage } from './azure-storage.js';
import { createReadiness, monitorReadiness } from './readiness.js';
import { createHttpServer } from './server.js';

let config;
try {
  config = parseConfig(process.env);
} catch {
  console.error(JSON.stringify({ event: 'startup_check_failed', code: 'CONFIG_INVALID' }));
}

const readiness = createReadiness({
  config,
  resolveIpv4: resolve4,
  verifyStorage: verifyAzureStorage
});
const server = createHttpServer(readiness);
const port = config?.port ?? 8080;
const shutdownController = new AbortController();

server.listen(port, '0.0.0.0', () => {
  void monitorReadiness(readiness, { signal: shutdownController.signal });
});

function shutdown() {
  shutdownController.abort();
  server.close(() => process.exit(0));
  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
