import { HttpError, handleChatPayload } from './lib/chatProxy.mjs';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function streamFromAsyncIterable(iterable) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterable.next();

        if (done) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      if (typeof iterable.return === 'function') {
        await iterable.return();
      }
    }
  });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Body request harus berupa JSON valid.' });
  }

  try {
    const disableWebSearch = Boolean(req.headers.get('x-disable-web-search'));
    const result = await handleChatPayload(payload, process.env, { disableWebSearch });

    if (result.type === 'json') {
      return json(200, result.payload);
    }

    return new Response(streamFromAsyncIterable(result.stream), {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Netlify streaming proxy error:', error);
    const statusCode = error instanceof HttpError ? error.statusCode : 502;
    const message = error instanceof HttpError ? error.message : 'Gagal menghubungi Ollama Cloud dari Netlify Function.';
    return json(statusCode, { error: message });
  }
};