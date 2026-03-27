const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { webSearch, MAX_WEB_RESULTS } = require('./webSearch.cjs');

const OLLAMA_CHAT_URL = 'https://ollama.com/api/chat';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TOOL_PROFILE = 'standard';
const MAX_TOOL_ITERATIONS = 10;
const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
const MAX_FILE_BYTES = 128_000;
const MAX_STDIO_BYTES = 32_000;

const STANDARD_TOOL_INSTRUCTION = 'You have access to a web_search tool for up-to-date internet information. Use it whenever the user asks for current, recent, breaking, latest, live, or web-specific facts. After using the tool, answer using the returned results and mention sources when useful.';
const AGENT_TOOL_INSTRUCTION = [
  'You are an autonomous task-solving agent.',
  'Plan your work in small steps, use tools iteratively, inspect the results, then decide the next step until the task is complete or you are blocked.',
  'Prefer file_manager for reading and editing workspace files, execute_shell for safe project-local commands, python_interpreter for Python execution, and web_search for fresh internet information.',
  'All shell and file operations are sandboxed to the project workspace. If a tool fails, adapt and continue when possible.',
  'When enough evidence is gathered, stop using tools and provide the final answer.'
].join(' ');
const AGENT_PLAN_INSTRUCTION = [
  'Create a concise execution plan for the current task.',
  'Return ONLY a JSON array with 3 to 5 objects.',
  'Each object must include a title and a status.',
  'Keep each title short, specific, and action-oriented.',
  'Use pending as the initial status for every step.',
  'Do not call tools, do not add markdown, and do not include explanation.'
].join(' ');

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

const AGENT_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'execute_shell',
      description: 'Run a safe, sandboxed command inside the project workspace.',
      parameters: {
        type: 'object',
        required: ['command'],
        properties: {
          command: {
            type: 'string',
            description: 'Base command name without pipes or shell operators.'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional argument list.'
          },
          timeout_ms: {
            type: 'integer',
            minimum: 1000,
            maximum: 60000
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_manager',
      description: 'Read, list, write, append, or edit UTF-8 text files inside the project workspace.',
      parameters: {
        type: 'object',
        required: ['action', 'path'],
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'list', 'write', 'append', 'edit']
          },
          path: {
            type: 'string',
            description: 'Path relative to the project workspace.'
          },
          content: {
            type: 'string',
            description: 'Required for write and append.'
          },
          find: {
            type: 'string',
            description: 'Required for edit.'
          },
          replace: {
            type: 'string',
            description: 'Replacement text for edit.'
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace every occurrence when true.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'python_interpreter',
      description: 'Execute Python code inside the project workspace and return stdout/stderr.',
      parameters: {
        type: 'object',
        required: ['code'],
        properties: {
          code: {
            type: 'string',
            description: 'Python code to execute.'
          },
          timeout_ms: {
            type: 'integer',
            minimum: 1000,
            maximum: 60000
          }
        }
      }
    }
  }
];

const FRONTEND_TOOL_NAMES = new Set(FRONTEND_TOOL_SCHEMAS.map((tool) => tool.function.name));
const TOOL_PROFILES = {
  standard: {
    includeFrontendTools: true,
    includeAgentTools: false,
    instruction: STANDARD_TOOL_INSTRUCTION
  },
  agent: {
    includeFrontendTools: true,
    includeAgentTools: true,
    instruction: AGENT_TOOL_INSTRUCTION
  }
};
const EXTERNAL_SHELL_COMMANDS = new Set(['git', 'node', 'npm', 'python', 'py']);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function normalizeToolProfile(toolProfile) {
  return toolProfile === 'agent' ? 'agent' : DEFAULT_TOOL_PROFILE;
}

function buildToolsList(webSearchEnabled, toolProfile = DEFAULT_TOOL_PROFILE) {
  const profile = TOOL_PROFILES[normalizeToolProfile(toolProfile)];
  const tools = [];

  if (webSearchEnabled) {
    tools.push(WEB_SEARCH_TOOL);
  }
  if (profile.includeFrontendTools) {
    tools.push(...FRONTEND_TOOL_SCHEMAS);
  }
  if (profile.includeAgentTools) {
    tools.push(...AGENT_TOOL_SCHEMAS);
  }

  return tools;
}

function buildMessages(messages, options = {}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  if (!options.toolsEnabled) {
    return safeMessages;
  }

  const toolProfile = normalizeToolProfile(options.toolProfile);
  return [{ role: 'system', content: TOOL_PROFILES[toolProfile].instruction }, ...safeMessages];
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

function toStreamEnvelope(message) {
  return `${JSON.stringify({ message })}\n`;
}

function createAgentEventEnvelope(phase, status, iteration) {
  return toStreamEnvelope({
    agent_event: {
      type: 'phase',
      phase,
      status,
      iteration
    }
  });
}

function createPlanEventEnvelope(planArray, iteration) {
  return toStreamEnvelope({
    agent_event: {
      type: 'plan-update',
      plan: normalizePlanArray(planArray),
      ...(Number.isFinite(iteration) ? { iteration } : {})
    }
  });
}

function normalizePlanStatus(status, fallback = 'pending') {
  const value = String(status || '').toLowerCase();
  if (value === 'active' || value === 'done' || value === 'error') {
    return value;
  }
  return fallback;
}

function normalizePlanTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

function isPlanTitleValid(title) {
  const normalized = normalizePlanTitle(title).toLowerCase();
  if (!normalized) {
    return false;
  }

  const blockedPhrases = [
    'return only',
    'json only',
    'json array',
    'return the execution plan',
    'do not call tools',
    'do not add markdown',
    'do not include explanation',
    'autonomous task-solving agent',
    'plan your work in small steps',
    'pending as the initial status',
    'when enough evidence is gathered'
  ];

  return !blockedPhrases.some((phrase) => normalized.includes(phrase));
}

function normalizePlanArray(planArray) {
  if (!Array.isArray(planArray)) {
    return [];
  }

  return planArray
    .map((step, index) => {
      const rawTitle = typeof step === 'string' ? step : step?.title;
      const title = normalizePlanTitle(rawTitle);
      if (!title || !isPlanTitleValid(title)) {
        return null;
      }

      return {
        id: typeof step === 'object' && step?.id ? String(step.id) : `plan-step-${index}`,
        title: title.slice(0, 120),
        status: normalizePlanStatus(typeof step === 'object' ? step?.status : 'pending')
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function clonePlanArray(planArray) {
  return normalizePlanArray(planArray).map((step) => ({ ...step }));
}

function getLastUserMessageText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') {
      continue;
    }

    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }

    if (Array.isArray(message.content)) {
      const joined = message.content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          return part?.text || '';
        })
        .join(' ')
        .trim();
      if (joined) {
        return joined;
      }
    }
  }

  return '';
}

function buildFallbackPlan(messages = []) {
  const lastUserMessage = getLastUserMessageText(messages);
  const contextualStep = lastUserMessage
    ? `Understand the request: ${normalizePlanTitle(lastUserMessage).slice(0, 72)}`
    : 'Understand the current request';

  return [
    { id: 'plan-step-0', title: contextualStep, status: 'pending' },
    { id: 'plan-step-1', title: 'Gather the needed context', status: 'pending' },
    { id: 'plan-step-2', title: 'Use the right tools to make progress', status: 'pending' },
    { id: 'plan-step-3', title: 'Verify the result and answer clearly', status: 'pending' }
  ];
}

function finalizePlanArray(planArray, messages = []) {
  const normalized = normalizePlanArray(planArray);
  if (normalized.length >= 3) {
    return normalized;
  }
  return buildFallbackPlan(messages);
}

function ensurePlanHasActiveStep(planArray) {
  const nextPlan = clonePlanArray(planArray);
  if (!nextPlan.length) {
    return nextPlan;
  }

  if (nextPlan.some((step) => step.status === 'active')) {
    return nextPlan;
  }

  const pendingIndex = nextPlan.findIndex((step) => step.status === 'pending');
  if (pendingIndex !== -1) {
    nextPlan[pendingIndex].status = 'active';
  }

  return nextPlan;
}

function completeActivePlanStep(planArray, options = {}) {
  const nextPlan = clonePlanArray(planArray);
  if (!nextPlan.length) {
    return nextPlan;
  }

  let activeIndex = nextPlan.findIndex((step) => step.status === 'active');
  if (activeIndex === -1) {
    activeIndex = nextPlan.findIndex((step) => step.status === 'pending');
  }

  if (activeIndex !== -1) {
    nextPlan[activeIndex].status = options.error ? 'error' : 'done';
  }

  if (options.activateNext) {
    const nextPendingIndex = nextPlan.findIndex((step, index) => index > activeIndex && step.status === 'pending');
    if (nextPendingIndex !== -1) {
      nextPlan[nextPendingIndex].status = 'active';
    }
  }

  return nextPlan;
}

function markEntirePlanDone(planArray) {
  const nextPlan = clonePlanArray(planArray);
  nextPlan.forEach((step) => {
    if (step.status === 'pending' || step.status === 'active') {
      step.status = 'done';
    }
  });
  return nextPlan;
}

function didToolExecutionFail(toolMessages = []) {
  return toolMessages.some((toolMessage) => {
    const parsed = parseToolArguments(toolMessage?.content);
    return parsed?.ok === false || Boolean(parsed?.error);
  });
}

function extractJsonArray(rawText) {
  const text = String(rawText || '');
  if (!text.trim()) {
    return null;
  }

  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (startIndex === -1) {
      if (char === '[') {
        startIndex = index;
        depth = 1;
        inString = false;
        escapeNext = false;
      }
      continue;
    }

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '[') {
      depth += 1;
      continue;
    }

    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(startIndex, index + 1).trim();
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
          startIndex = -1;
          depth = 0;
          inString = false;
          escapeNext = false;
        }
      }
    }
  }

  return null;
}

function buildAgentPlanMessages(messages = []) {
  const lastUserMessage = getLastUserMessageText(messages) || 'Help solve the latest user request.';
  return [
    { role: 'system', content: AGENT_TOOL_INSTRUCTION },
    { role: 'system', content: AGENT_PLAN_INSTRUCTION },
    { role: 'user', content: lastUserMessage }
  ];
}

async function generateAgentPlan(payload, env) {
  const planningPayload = {
    model: payload.model,
    messages: buildAgentPlanMessages(payload.messages),
    stream: false,
    ...(payload.options ? { options: payload.options } : {}),
    ...(payload.keep_alive ? { keep_alive: payload.keep_alive } : {}),
    ...(payload.think !== undefined ? { think: false } : {})
  };

  const upstream = await callOllama(planningPayload, env.OLLAMA_API_KEY);
  const responseState = await consumeJson(upstream);
  const parsedPlan = extractJsonArray(responseState.content);
  return ensurePlanHasActiveStep(finalizePlanArray(parsedPlan, payload.messages));
}

function resolveWorkspaceRoot(env) {
  return path.resolve(env.AGENT_WORKSPACE_ROOT || PROJECT_ROOT);
}

function resolveWorkspacePath(rootDir, inputPath = '.') {
  const workspaceRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(workspaceRoot, String(inputPath || '.'));

  if (resolvedPath !== workspaceRoot && !resolvedPath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new HttpError(403, 'Path di luar workspace tidak diizinkan.');
  }

  return resolvedPath;
}

function truncateOutput(value, maxLength = MAX_STDIO_BYTES) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n...[truncated]`;
}

function normalizeCommandName(command) {
  return path.basename(String(command || '').trim()).toLowerCase().replace(/\.exe$/i, '');
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

async function runProcess(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      stdout = truncateOutput(stdout);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      stderr = truncateOutput(stderr);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new HttpError(408, `Process timeout setelah ${options.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS} ms.`));
        return;
      }

      resolve({
        ok: code === 0,
        exit_code: code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function validateExternalShellArgs(command, args, rootDir) {
  const safeArgs = Array.isArray(args) ? args.map((item) => String(item)) : [];

  if (command === 'git') {
    const subcommand = safeArgs[0] || '';
    if (!['status', 'diff', 'log', 'show', 'branch', 'rev-parse'].includes(subcommand)) {
      throw new HttpError(403, `Subcommand git "${subcommand}" tidak diizinkan.`);
    }
    return safeArgs;
  }

  if (command === 'npm') {
    const firstArg = safeArgs[0] || '';
    if (!['run', 'test', '--version', '-v'].includes(firstArg)) {
      throw new HttpError(403, `npm "${firstArg}" tidak diizinkan.`);
    }
    return safeArgs;
  }

  if (command === 'node') {
    const firstArg = safeArgs[0] || '';
    if (['--version', '-v'].includes(firstArg)) {
      return safeArgs;
    }
    if (!firstArg || firstArg.startsWith('-')) {
      throw new HttpError(403, 'node hanya diizinkan untuk version check atau menjalankan file script workspace.');
    }
    resolveWorkspacePath(rootDir, firstArg);
    return safeArgs;
  }

  if (command === 'python' || command === 'py') {
    if (!safeArgs.length) {
      throw new HttpError(400, `${command} membutuhkan argumen.`);
    }

    if (safeArgs.every((arg) => ['--version', '-V', '-3'].includes(arg))) {
      return safeArgs;
    }

    let scriptIndex = 0;
    if (command === 'py' && safeArgs[0] === '-3') {
      scriptIndex = 1;
    }

    const scriptPath = safeArgs[scriptIndex] || '';
    if (!scriptPath || scriptPath.startsWith('-')) {
      throw new HttpError(403, `${command} hanya diizinkan untuk version check atau menjalankan file script workspace.`);
    }
    resolveWorkspacePath(rootDir, scriptPath);
    return safeArgs;
  }

  throw new HttpError(403, `Command "${command}" tidak diizinkan.`);
}

async function executeShellTool(args, env) {
  const rootDir = resolveWorkspaceRoot(env);
  const command = normalizeCommandName(args?.command);
  const shellArgs = Array.isArray(args?.args) ? args.args.map((item) => String(item)) : [];
  const timeoutMs = Number(args?.timeout_ms) || DEFAULT_TOOL_TIMEOUT_MS;

  if (command === 'pwd') {
    return {
      ok: true,
      command,
      args: [],
      cwd: rootDir,
      stdout: rootDir,
      stderr: '',
      exit_code: 0
    };
  }

  if (command === 'echo') {
    return {
      ok: true,
      command,
      args: shellArgs,
      cwd: rootDir,
      stdout: shellArgs.join(' '),
      stderr: '',
      exit_code: 0
    };
  }

  if (command === 'ls' || command === 'dir') {
    const targetArg = shellArgs[0] || '.';
    const targetPath = resolveWorkspacePath(rootDir, targetArg);
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return {
      ok: true,
      command,
      args: shellArgs,
      cwd: rootDir,
      stdout: entries.slice(0, 200).map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`).join('\n'),
      stderr: '',
      exit_code: 0
    };
  }

  if (command === 'cat' || command === 'type') {
    const targetArg = shellArgs[0];
    if (!targetArg) {
      throw new HttpError(400, `${command} membutuhkan path file.`);
    }
    const targetPath = resolveWorkspacePath(rootDir, targetArg);
    const content = await fs.readFile(targetPath, 'utf8');
    return {
      ok: true,
      command,
      args: shellArgs,
      cwd: rootDir,
      stdout: truncateOutput(content, MAX_FILE_BYTES),
      stderr: '',
      exit_code: 0
    };
  }

  if (!EXTERNAL_SHELL_COMMANDS.has(command)) {
    throw new HttpError(403, `Command "${command}" tidak ada di allowlist.`);
  }

  const validatedArgs = validateExternalShellArgs(command, shellArgs, rootDir);
  const result = await runProcess(command, validatedArgs, {
    cwd: rootDir,
    timeoutMs
  });

  return {
    ok: result.ok,
    command,
    args: validatedArgs,
    cwd: rootDir,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code
  };
}

async function fileManagerTool(args, env) {
  const rootDir = resolveWorkspaceRoot(env);
  const action = String(args?.action || '').toLowerCase();
  const relativePath = String(args?.path || '.');
  const absolutePath = resolveWorkspacePath(rootDir, relativePath);

  if (action === 'read') {
    const content = await fs.readFile(absolutePath, 'utf8');
    return {
      ok: true,
      action,
      path: relativePath,
      content: truncateOutput(content, MAX_FILE_BYTES),
      truncated: content.length > MAX_FILE_BYTES
    };
  }

  if (action === 'list') {
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      return {
        ok: true,
        action,
        path: relativePath,
        entries: [{ name: path.basename(absolutePath), type: 'file' }]
      };
    }

    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    return {
      ok: true,
      action,
      path: relativePath,
      entries: entries.slice(0, 200).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : 'file'
      }))
    };
  }

  if (action === 'write' || action === 'append') {
    const content = String(args?.content || '');
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    if (action === 'write') {
      await fs.writeFile(absolutePath, content, 'utf8');
    } else {
      await fs.appendFile(absolutePath, content, 'utf8');
    }

    return {
      ok: true,
      action,
      path: relativePath,
      bytes: Buffer.byteLength(content, 'utf8')
    };
  }

  if (action === 'edit') {
    const find = String(args?.find || '');
    const replace = String(args?.replace || '');
    const replaceAll = Boolean(args?.replace_all);

    if (!find) {
      throw new HttpError(400, 'field "find" wajib untuk file_manager action=edit.');
    }

    const original = await fs.readFile(absolutePath, 'utf8');
    if (!original.includes(find)) {
      throw new HttpError(404, 'Teks target tidak ditemukan di file.');
    }

    const updated = replaceAll ? original.split(find).join(replace) : original.replace(find, replace);
    await fs.writeFile(absolutePath, updated, 'utf8');

    return {
      ok: true,
      action,
      path: relativePath,
      replaced: replaceAll ? 'all' : 1
    };
  }

  throw new HttpError(400, `file_manager action "${action}" tidak didukung.`);
}

async function pythonInterpreterTool(args, env) {
  const rootDir = resolveWorkspaceRoot(env);
  const code = String(args?.code || '');
  const timeoutMs = Number(args?.timeout_ms) || DEFAULT_TOOL_TIMEOUT_MS;

  if (!code.trim()) {
    throw new HttpError(400, 'Python code kosong.');
  }

  const candidates = process.platform === 'win32'
    ? [['python', ['-']], ['py', ['-3', '-']]]
    : [['python3', ['-']], ['python', ['-']]];

  let lastError = null;
  for (const [command, commandArgs] of candidates) {
    try {
      const result = await runProcess(command, commandArgs, {
        cwd: rootDir,
        stdin: code,
        timeoutMs
      });

      return {
        ok: result.ok,
        command,
        cwd: rootDir,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new HttpError(500, lastError?.message || 'Python interpreter tidak tersedia.');
}

const TOOL_EXECUTORS = {
  web_search: async (args, env) => {
    const query = String(args?.query || '').trim();
    const results = await webSearch(query, { apiKey: env.TAVILY_API_KEY, maxResults: MAX_WEB_RESULTS });
    return {
      ok: true,
      query,
      results
    };
  },
  execute_shell: executeShellTool,
  file_manager: fileManagerTool,
  python_interpreter: pythonInterpreterTool
};

async function executeToolCalls(toolCalls, env) {
  const toolMessages = [];

  for (const toolCall of toolCalls) {
    const toolName = toolCall?.function?.name || 'unknown_tool';
    const args = parseToolArguments(toolCall?.function?.arguments);
    const executor = TOOL_EXECUTORS[toolName];

    if (!executor) {
      toolMessages.push({
        role: 'tool',
        tool_name: toolName,
        content: JSON.stringify({ ok: false, error: `Unsupported tool: ${toolName}` })
      });
      continue;
    }

    try {
      const result = await executor(args, env);
      toolMessages.push({
        role: 'tool',
        tool_name: toolName,
        content: JSON.stringify(result)
      });
    } catch (error) {
      toolMessages.push({
        role: 'tool',
        tool_name: toolName,
        content: JSON.stringify({
          ok: false,
          error: error.message || `${toolName} gagal dijalankan.`,
          query: args?.query,
          path: args?.path,
          command: args?.command,
          results: []
        })
      });
    }
  }

  return toolMessages;
}

async function* createChatStream(payload, env, options = {}) {
  const toolProfile = normalizeToolProfile(payload.toolProfile);
  const webSearchEnabled = Boolean(env.TAVILY_API_KEY) && !options.disableWebSearch;
  const tools = buildToolsList(webSearchEnabled, toolProfile);
  const toolsEnabled = tools.length > 0;
  const isAgentProfile = toolProfile === 'agent';
  let messages = buildMessages(payload.messages, {
    toolsEnabled,
    toolProfile
  });
  let currentPlan = [];

  if (isAgentProfile) {
    try {
      currentPlan = await generateAgentPlan(payload, env);
    } catch {
      currentPlan = ensurePlanHasActiveStep(buildFallbackPlan(payload.messages));
    }

    if (currentPlan.length) {
      yield createPlanEventEnvelope(currentPlan, 1);
    }
  }

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    const iteration = step + 1;
    if (isAgentProfile && currentPlan.length && iteration > 1) {
      currentPlan = ensurePlanHasActiveStep(currentPlan);
      yield createPlanEventEnvelope(currentPlan, iteration);
    }

    const upstreamPayload = {
      ...payload,
      messages,
      stream: true,
      ...(toolsEnabled ? { tools } : {})
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
      if (isAgentProfile && currentPlan.length) {
        currentPlan = markEntirePlanDone(currentPlan);
        yield createPlanEventEnvelope(currentPlan, iteration);
      }
      return;
    }

    const frontendToolCalls = streamState.toolCalls.filter((toolCall) =>
      FRONTEND_TOOL_NAMES.has(toolCall?.function?.name)
    );
    const backendToolCalls = streamState.toolCalls.filter((toolCall) =>
      !FRONTEND_TOOL_NAMES.has(toolCall?.function?.name)
    );

    let backendToolFailed = false;
    let shouldAdvancePlan = false;

    if (backendToolCalls.length) {
      const toolMessages = await executeToolCalls(backendToolCalls, env);
      backendToolFailed = didToolExecutionFail(toolMessages);
      shouldAdvancePlan = true;
      for (const toolMessage of toolMessages) {
        yield toStreamEnvelope(toolMessage);
      }
      messages = [...messages, ...toolMessages];
    }

    if (frontendToolCalls.length) {
      shouldAdvancePlan = true;
    }

    if (isAgentProfile && currentPlan.length && shouldAdvancePlan) {
      currentPlan = completeActivePlanStep(currentPlan, {
        activateNext: !backendToolFailed,
        error: backendToolFailed
      });
      yield createPlanEventEnvelope(currentPlan, iteration);
    }

    if (frontendToolCalls.length) {
      return;
    }
  }

  throw new HttpError(500, 'Tool loop melebihi batas maksimum.');
}

async function runChatJson(payload, env, options = {}) {
  const toolProfile = normalizeToolProfile(payload.toolProfile);
  const webSearchEnabled = Boolean(env.TAVILY_API_KEY) && !options.disableWebSearch;
  const tools = buildToolsList(webSearchEnabled, toolProfile);
  const toolsEnabled = tools.length > 0;
  let messages = buildMessages(payload.messages, {
    toolsEnabled,
    toolProfile
  });

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    const upstreamPayload = {
      ...payload,
      messages,
      stream: false,
      ...(toolsEnabled ? { tools } : {})
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

    const toolMessages = await executeToolCalls(responseState.toolCalls, env);
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
