const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, handleChatPayload } = require('./backend/chatProxy.cjs');

const ROOT_DIR = __dirname;

loadEnvFile(path.join(ROOT_DIR, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const normalizedValue = rawValue.replace(/^['"]|['"]$/g, '');

    if (key && !process.env[key]) {
      process.env[key] = normalizedValue;
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Payload terlalu besar.'));
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleChatProxy(req, res) {
  let rawBody;
  try {
    rawBody = await readRequestBody(req);
  } catch (error) {
    return sendJson(res, 413, { error: error.message });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return sendJson(res, 400, { error: 'Body request harus berupa JSON valid.' });
  }

  try {
    const result = await handleChatPayload(payload, process.env);

    if (result.type === 'json') {
      return sendJson(res, 200, result.payload);
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache'
    });

    for await (const chunk of result.stream) {
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 502;
    const message = error instanceof HttpError ? error.message : 'Gagal menghubungi Ollama Cloud dari server proxy.';

    if (!res.headersSent) {
      return sendJson(res, statusCode, { error: message });
    }

    console.error('Streaming proxy error:', error);
    res.end();
  }
}

function serveStaticFile(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const normalizedPath = path.normalize(path.join(ROOT_DIR, requestedPath));

  if (!normalizedPath.startsWith(ROOT_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.readFile(normalizedPath, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') {
        return sendText(res, 404, 'Not found');
      }

      console.error('Static file error:', error);
      return sendText(res, 500, 'Internal server error');
    }

    const extension = path.extname(normalizedPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    return sendText(res, 400, 'Bad request');
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    return void handleChatProxy(req, res);
  }

  if (req.method === 'GET') {
    return void serveStaticFile(req, res);
  }

  sendText(res, 405, 'Method not allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`Qwen chat app ready at http://${HOST}:${PORT}`);
});