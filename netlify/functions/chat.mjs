import { HttpError, handleChatPayload } from './lib/chatProxy.mjs';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
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
    const result = await handleChatPayload({
      ...payload,
      stream: false
    }, process.env);

    return json(200, result.payload);
  } catch (error) {
    console.error('Netlify JSON proxy error:', error);
    const statusCode = error instanceof HttpError ? error.statusCode : 502;
    const message = error instanceof HttpError ? error.message : 'Gagal menghubungi Ollama Cloud dari Netlify Function.';
    return json(statusCode, { error: message });
  }
};