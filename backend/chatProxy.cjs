const { webSearch, MAX_WEB_RESULTS } = require('./webSearch.cjs');

const OLLAMA_CHAT_URL = 'https://ollama.com/api/chat';
const MAX_TOOL_ITERATIONS = 4;
const TOOL_INSTRUCTION = 'You have access to a web_search tool for up-to-date internet information. Use it whenever the user asks for current, recent, breaking, latest, live, or web-specific facts. After using the tool, answer using the returned results and mention sources when useful.';

const WEB_SEARCH_TOOL = {
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

const FRONTEND_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Evaluate a mathematical expression and return the numeric result.',
      parameters: {
        type: 'object',
        required: ['expression'],
        properties: {
          expression: {
            type: 'string',
            description: 'The math expression to evaluate, e.g. "2^10 + sqrt(144)".'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'datetime',
      description: 'Get the current date, time, and timezone information.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Optional IANA timezone name, e.g. "Asia/Jakarta".'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'code_runner',
      description: 'Execute JavaScript code in a sandboxed iframe and return the console output.',
      parameters: {
        type: 'object',
        required: ['code', 'language'],
        properties: {
          code: {
            type: 'string',
            description: 'Valid JavaScript code to execute.'
          },
          language: {
            type: 'string',
            description: 'Must always be "javascript".'
          }
        }
      }
    }
  }
];

const FRONTEND_TOOL_NAMES = new Set(FRONTEND_TOOL_SCHEMAS.map((tool) => tool.function.name));

function buildToolsList(webSearchEnabled) {
  if (webSearchEnabled) {
    return [WEB_SEARCH_TOOL, ...FRONTEND_TOOL_SCHEMAS];
  }
  return [...FRONTEND_TOOL_SCHEMAS];
}

class HttpError extends Error {
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
  state.lastEnvelope = parsed;
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

async function* createChatStream(payload, env, options = {}) {
  const webSearchEnabled = Boolean(env.TAVILY_API_KEY) && !options.disableWebSearch;
  const tools = buildToolsList(webSearchEnabled);
  let messages = buildMessages(payload.messages, webSearchEnabled);

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
      toolCalls: [],
      lastEnvelope: null
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

    const hasFrontendTools = streamState.toolCalls.some((toolCall) =>
      FRONTEND_TOOL_NAMES.has(toolCall?.function?.name)
    );

    if (hasFrontendTools) {
      const webSearchCalls = streamState.toolCalls.filter(
        (toolCall) => toolCall?.function?.name === 'web_search'
      );
      if (webSearchCalls.length) {
        const toolMessages = await executeToolCalls(webSearchCalls, env.TAVILY_API_KEY);
        for (const toolMessage of toolMessages) {
          yield `${JSON.stringify({ message: toolMessage })}\n`;
        }
        messages = [...messages, ...toolMessages];
      }
      return;
    }

    const toolMessages = await executeToolCalls(streamState.toolCalls, env.TAVILY_API_KEY);
    for (const toolMessage of toolMessages) {
      yield `${JSON.stringify({ message: toolMessage })}\n`;
    }
    messages = [...messages, ...toolMessages];
  }

  throw new HttpError(500, 'Tool loop melebihi batas maksimum.');
}

async function runChatJson(payload, env, options = {}) {
  const webSearchEnabled = Boolean(env.TAVILY_API_KEY) && !options.disableWebSearch;
  const tools = buildToolsList(webSearchEnabled);
  let messages = buildMessages(payload.messages, webSearchEnabled);

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

async function handleChatPayload(payload, env, options = {}) {
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
      payload: await runChatJson(payload, env, options)
    };
  }

  return {
    type: 'stream',
    stream: createChatStream(payload, env, options)
  };
}

module.exports = {
  HttpError,
  MAX_TOOL_ITERATIONS,
  WEB_SEARCH_TOOL,
  handleChatPayload
};









