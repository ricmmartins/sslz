const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_HOST_PATTERN = /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/;

export class StartupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function parseConfig(env) {
  const clientId = env.AZURE_CLIENT_ID;
  const accountUrl = env.BLOB_ACCOUNT_URL;
  const container = env.BLOB_CONTAINER;
  const port = env.PORT === undefined ? 8080 : Number(env.PORT);

  if (
    typeof clientId !== 'string' ||
    !UUID_PATTERN.test(clientId) ||
    typeof accountUrl !== 'string' ||
    typeof container !== 'string' ||
    container !== 'acceptance' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new StartupError('CONFIG_INVALID');
  }

  let url;
  try {
    url = new URL(accountUrl);
  } catch {
    throw new StartupError('CONFIG_INVALID');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    !STORAGE_HOST_PATTERN.test(url.hostname)
  ) {
    throw new StartupError('CONFIG_INVALID');
  }

  return Object.freeze({
    clientId,
    accountUrl: `https://${url.hostname}`,
    container,
    hostname: url.hostname,
    port
  });
}
