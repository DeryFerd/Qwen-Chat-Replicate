import { webSearch, MAX_WEB_RESULTS } from './webSearch.mjs';

const OLLAMA_CHAT_URL = 'https://ollama.com/api/chat';
const MAX_TOOL_ITERATIONS = 4;
const TOOL_INSTRUCTION = 'You have access to a web_search tool for up-to-date internet information. Use it whenever the user asks for current, recent, breaking, latest, live, or web-specific facts. After using the tool, answer using the returned results and mention sources when useful.';

export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: `Search the public web for fresh information and return up to ${MAX_WEB_RESULTS} relevant results with title, url, and content snippets.`,
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'The internet search query to run.'
        }
      }
    }
  }
};

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function buildMessages(messages, toolsEnabled) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  return toolsEnabled ? [{ role: 'system', content: TOOL_INSTRUCTION }, ...safeMessages] : safeMessages;
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === 'string') {
    try {
      return JSON.parse(rawArguments);
    } catch {
      return { query: rawArguments };
    }
  }

  return rawArguments;
}

function mergeToolCalls(target, incoming) {
  if (!Array.isArray(incoming)) {
    return target;
  }

  for (const toolCall of incoming) {
    const name = toolCall?.function?.name || 'unknown_tool';
    const args = parseToolArguments(toolCall?.function?.arguments);
    const key = `${name}:${JSON.stringify(args)}`;

    if (!target.some((existing) => `${existing.function.name}:${JSON.stringify(existing.function.arguments)}` === key)) {
      target.push({
        type: 'function',
        function: {
          name,
          arguments: args
        }
      });
    }
  }

  return target;
}

async function readUpstreamError(response) {
  const rawText = await response.text();
  if (!rawText) {
    return `Ollama Cloud error (${response.status})`;
  }

  try {
    const parsed = JSON.parse(rawText);
    return parsed.error || parsed.message || rawText;
  } catch {
    return rawText;
  }
}

async function callOllama(payload, ollamaApiKey) {
  const response = await fetch(OLLAMA_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ollamaApiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new HttpError(response.status, await readUpstreamError(response));
  }

  return response;
}

function parseStreamLine(rawLine, state) {
  const trimmedLine = rawLine.trim();
  if (!trimmedLine) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmedLine);
  } catch {
    return;
  }

  const message = parsed?.message || {};
  if (message.thinking) {
    state.thinking += message.thinking;
  }
  if (message.content) {
    state.content += message.content;
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    mergeToolCalls(state.toolCalls, message.tool_calls);
  }
}

async function* iterateNdjsonLines(body) {
  if (!body) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let pending = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        yield line;
      }
    }
  }

  pending += decoder.decode();
  const trailingLines = pending.split('\n');
  for (const line of trailingLines) {
    if (line.trim()) {
      yield line;
    }
  }
}

async function consumeJson(response) {
  const payload = await response.json();
  return {
    payload,
    content: payload?.message?.content || payload?.response || '',
    thinking: payload?.message?.thinking || payload?.thinking || '',
    toolCalls: mergeToolCalls([], payload?.message?.tool_calls || [])
  };
}

async function executeToolCalls(toolCalls, tavilyApiKey) {
  const toolMessages = [];

  for (const toolCall of toolCalls) {
    const toolName = toolCall?.function?.name || 'unknown_tool';
    const args = parseToolArguments(toolCall?.function?.arguments);

    if (toolName !== 'web_search') {
      toolMessages.push({
        role: 'tool',
        tool_name: toolName,
        content: JSON.stringify({ error: `Unsupported tool: ${toolName}` })
      });
      continue;
    }

    const query = String(args?.query || '').trim();

    try {
      const results = await webSearch(query, { apiKey: tavilyApiKey, maxResults: MAX_WEB_RESULTS });
      toolMessages.push({
        role: 'tool',
        tool_name: toolName,
        content: JSON.stringify({ query, results })
      });
    } catch (error) {
      toolMessages.push({
        role: 'tool',
        tool_name: toolName,
        content: JSON.stringify({
          query,
          error: error.message || 'Web search gagal dijalankan.',
          results: []
        })
      });
    }
  }

  return toolMessages;
}

async function* createChatStream(payload, env) {
  const toolsEnabled = Boolean(env.TAVILY_API_KEY);
  const tools = toolsEnabled ? [WEB_SEARCH_TOOL] : undefined;
  let messages = buildMessages(payload.messages, toolsEnabled);

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    const upstreamPayload = {
      ...payload,
      messages,
      stream: true,
      ...(tools ? { tools } : {})
    };

    const upstream = await callOllama(upstreamPayload, env.OLLAMA_API_KEY);
    const streamState = {
      content: '',
      thinking: '',
      toolCalls: []
    };

    for await (const line of iterateNdjsonLines(upstream.body)) {
      parseStreamLine(line, streamState);
      yield `${line}\n`;
    }

    messages = [
      ...messages,
      {
        role: 'assistant',
        content: streamState.content,
        thinking: streamState.thinking,
        ...(streamState.toolCalls.length ? { tool_calls: streamState.toolCalls } : {})
      }
    ];

    if (!streamState.toolCalls.length) {
      return;
    }

    const toolMessages = await executeToolCalls(streamState.toolCalls, env.TAVILY_API_KEY);
    messages = [...messages, ...toolMessages];
  }

  throw new HttpError(500, 'Tool loop melebihi batas maksimum.');
}

async function runChatJson(payload, env) {
  const toolsEnabled = Boolean(env.TAVILY_API_KEY);
  const tools = toolsEnabled ? [WEB_SEARCH_TOOL] : undefined;
  let messages = buildMessages(payload.messages, toolsEnabled);

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    const upstreamPayload = {
      ...payload,
      messages,
      stream: false,
      ...(tools ? { tools } : {})
    };

    const upstream = await callOllama(upstreamPayload, env.OLLAMA_API_KEY);
    const responseState = await consumeJson(upstream);

    messages = [
      ...messages,
      {
        role: 'assistant',
        content: responseState.content,
        thinking: responseState.thinking,
        ...(responseState.toolCalls.length ? { tool_calls: responseState.toolCalls } : {})
      }
    ];

    if (!responseState.toolCalls.length) {
      return responseState.payload;
    }

    const toolMessages = await executeToolCalls(responseState.toolCalls, env.TAVILY_API_KEY);
    messages = [...messages, ...toolMessages];
  }

  throw new HttpError(500, 'Tool loop melebihi batas maksimum.');
}

export async function handleChatPayload(payload, env) {
  if (!env.OLLAMA_API_KEY) {
    throw new HttpError(500, 'OLLAMA_API_KEY belum diset di environment backend.');
  }

  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Body request harus berupa JSON valid.');
  }

  if (!Array.isArray(payload.messages)) {
    throw new HttpError(400, 'Payload chat harus memiliki array messages.');
  }

  if (!payload.model) {
    throw new HttpError(400, 'Payload chat harus memiliki model.');
  }

  if (payload.stream === false) {
    return {
      type: 'json',
      payload: await runChatJson(payload, env)
    };
  }

  return {
    type: 'stream',
    stream: createChatStream(payload, env)
  };
}