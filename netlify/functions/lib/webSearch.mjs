export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
export const MAX_WEB_RESULTS = 5;

function inferTavilyTopic(query) {
  const normalized = String(query || '').toLowerCase();
  const newsSignals = ['latest', 'news', 'today', 'recent', 'breaking', 'current', 'update', 'yesterday', 'this week'];
  return newsSignals.some((signal) => normalized.includes(signal)) ? 'news' : 'general';
}

export async function webSearch(query, options = {}) {
  const trimmedQuery = String(query || '').trim();
  const apiKey = options.apiKey || process.env.TAVILY_API_KEY;
  const maxResults = Math.min(MAX_WEB_RESULTS, Math.max(1, Number(options.maxResults || MAX_WEB_RESULTS)));

  if (!trimmedQuery) {
    throw new Error('web_search membutuhkan query yang valid.');
  }

  if (!apiKey) {
    throw new Error('TAVILY_API_KEY belum dikonfigurasi di backend.');
  }

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      query: trimmedQuery,
      max_results: maxResults,
      search_depth: 'advanced',
      topic: inferTavilyTopic(trimmedQuery),
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false
    })
  });

  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error('Respons Tavily tidak valid.');
    }
  }

  if (!response.ok) {
    const errorMessage = payload.detail || payload.error || payload.message || `Tavily error (${response.status})`;
    throw new Error(errorMessage);
  }

  return (Array.isArray(payload.results) ? payload.results : []).slice(0, maxResults).map((result) => ({
    title: result?.title || 'Untitled result',
    url: result?.url || '',
    content: result?.content || ''
  }));
}