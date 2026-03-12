const OLLAMA_CHAT_URL = 'https://ollama.com/api/chat';

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

  if (!process.env.OLLAMA_API_KEY) {
    return json(500, { error: 'OLLAMA_API_KEY belum diset di environment Netlify.' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Body request harus berupa JSON valid.' });
  }

  const upstreamPayload = {
    ...payload,
    stream: payload?.stream !== false
  };

  try {
    const upstream = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OLLAMA_API_KEY}`
      },
      body: JSON.stringify(upstreamPayload)
    });

    if (!upstream.ok) {
      const rawText = await upstream.text();
      let errorMessage = `Ollama Cloud error (${upstream.status})`;

      if (rawText) {
        try {
          const parsed = JSON.parse(rawText);
          errorMessage = parsed.error || parsed.message || rawText;
        } catch {
          errorMessage = rawText;
        }
      }

      return json(upstream.status, { error: errorMessage });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstreamPayload.stream === false ? (upstream.headers.get('content-type') || 'application/json; charset=utf-8') : 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Netlify streaming proxy error:', error);
    return json(502, { error: 'Gagal menghubungi Ollama Cloud dari Netlify Function.' });
  }
};
