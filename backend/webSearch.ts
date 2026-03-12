export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
};

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const MAX_WEB_RESULTS = 5;

function inferTavilyTopic(query: string): 'general' | 'news' {
  const normalized = query.toLowerCase();
  const newsSignals = ['latest', 'news', 'today', 'recent', 'breaking', 'current', 'update', 'yesterday', 'this week'];
  return newsSignals.some((signal) => normalized.includes(signal)) ? 'news' : 'general';
}

export async function webSearch(query: string, apiKey = process.env.TAVILY_API_KEY): Promise<WebSearchResult[]> {
  const trimmedQuery = query.trim();

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
      max_results: MAX_WEB_RESULTS,
      search_depth: 'advanced',
      topic: inferTavilyTopic(trimmedQuery),
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || payload.message || `Tavily error (${response.status})`);
  }

  return (Array.isArray(payload.results) ? payload.results : []).slice(0, MAX_WEB_RESULTS).map((result: any) => ({
    title: result?.title || 'Untitled result',
    url: result?.url || '',
    content: result?.content || ''
  }));
}