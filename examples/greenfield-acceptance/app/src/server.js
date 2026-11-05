import { createServer } from 'node:http';

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

export function createHttpServer(readiness) {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET', 'content-length': '0' });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      response.writeHead(400, { 'content-length': '0' });
      response.end();
      return;
    }

    if (pathname === '/healthz') {
      sendJson(response, 200, { status: 'ok' });
    } else if (pathname === '/readyz') {
      const snapshot = readiness.snapshot();
      sendJson(response, snapshot.status === 'ready' ? 200 : 503, snapshot);
    } else {
      response.writeHead(404, { 'content-length': '0' });
      response.end();
    }
  });

  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  return server;
}
