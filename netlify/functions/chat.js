const OLLAMA_CHAT_URL = 'https://ollama.com/api/chat';

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(payload)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!process.env.OLLAMA_API_KEY) {
    return json(500, { error: 'OLLAMA_API_KEY belum diset di environment Netlify.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body request harus berupa JSON valid.' });
  }

  const upstreamPayload = {
    ...payload,
    stream: false
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

    const rawText = await upstream.text();

    if (!upstream.ok) {
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      },
      body: rawText
    };
  } catch (error) {
    console.error('Netlify function proxy error:', error);
    return json(502, { error: 'Gagal menghubungi Ollama Cloud dari Netlify Function.' });
  }
};
