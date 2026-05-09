#!/usr/bin/env node
// tenacity-harness — one tiny script. one soul file. one long-horizon task.
//
// the model sees soul.md every tick and answers with one or more tool calls.
// the harness runs them, hands the results back next tick, and keeps going
// until the model calls `done` (or until max ticks).

import { writeFile, readFile, appendFile, readdir, stat } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SOUL = path.join(root, 'soul.md');
const LOG = path.join(root, 'log.txt');
const LAST = path.join(root, '.last-results.md');

const MODEL = process.env.TENACITY_MODEL || 'llama3.2';
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MAX_TICKS = Number(process.env.TENACITY_MAX_TICKS || 500);
const TICK_DELAY = Number(process.env.TENACITY_TICK_DELAY_MS || 0);
const TICK_TIMEOUT = Number(process.env.TENACITY_TICK_TIMEOUT_MS || 120_000);
const CMD_TIMEOUT = Number(process.env.TENACITY_CMD_TIMEOUT_MS || 60_000);

// ─── tools ──────────────────────────────────────────────────────────────────
//
// each tool: { name, description, schema, execute(args, ctx), executionMode? }
// schema is a tiny json-schema subset (type + required + properties).

const TOOLS = [
  {
    name: 'shell',
    description: 'run a shell command. blocks the tick until exit.',
    schema: { type: 'object', required: ['cmd'], properties: { cmd: { type: 'string' } } },
    executionMode: 'sequential',
    execute: ({ cmd }, ctx) =>
      new Promise((resolve) => {
        const child = exec(cmd, { timeout: CMD_TIMEOUT }, (err, stdout, stderr) => {
          const lines = [];
          if (stdout?.trim()) lines.push(stdout.trimEnd());
          if (stderr?.trim()) lines.push(`[stderr] ${stderr.trimEnd()}`);
          if (err?.killed) lines.push('[killed: timeout]');
          else if (err) lines.push(`[exit ${err.code ?? 1}] ${err.message}`);
          resolve({ output: lines.join('\n') || '(no output)' });
        });
        child.stdout?.on('data', (d) => ctx.onPartial?.(`[stdout] ${String(d).trimEnd()}`));
        child.stderr?.on('data', (d) => ctx.onPartial?.(`[stderr] ${String(d).trimEnd()}`));
        ctx.signal?.addEventListener('abort', () => { try { child.kill('SIGKILL'); } catch {} });
      }),
  },
  {
    name: 'write_soul',
    description: 'overwrite soul.md with new content. use when re-organizing your identity, plan, or memory.',
    schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' } } },
    execute: async ({ content }) => {
      await writeFile(SOUL, content + '\n', 'utf8');
      return { output: `soul rewritten (${content.length} chars)` };
    },
  },
  {
    name: 'append_soul',
    description: 'append a timestamped line to soul.md. cheap, append-only scratchpad.',
    schema: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } },
    execute: async ({ note }) => {
      const stamp = new Date().toISOString();
      await appendFile(SOUL, `\n- [${stamp}] ${note.trim()}`, 'utf8');
      return { output: `appended: ${note.trim()}` };
    },
  },
  {
    name: 'read_file',
    description: 'read a file relative to the harness root. optional start/end (char offsets) for slicing big files.',
    schema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
    },
    executionMode: 'parallel',
    execute: async ({ path: rel, start, end }) => {
      const abs = safe(rel);
      let content;
      try { content = await readFile(abs, 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') return { output: `not found: ${rel}` }; throw e; }
      const s = typeof start === 'number' ? Math.max(0, start) : 0;
      const e = typeof end === 'number' ? Math.min(content.length, end) : content.length;
      const slice = content.slice(s, e);
      const head = s === 0 && e === content.length
        ? `${rel} — ${content.length} chars`
        : `${rel} — chars [${s}..${e}) of ${content.length}`;
      return { output: `${head}\n\n${slice}` };
    },
  },
  {
    name: 'write_file',
    description: 'write (overwrite) a file relative to the harness root.',
    schema: {
      type: 'object',
      required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } },
    },
    execute: async ({ path: rel, content }) => {
      await writeFile(safe(rel), content, 'utf8');
      return { output: `wrote ${content.length} chars to ${rel}` };
    },
  },
  {
    name: 'list_files',
    description: 'list a directory relative to the harness root (default: root).',
    schema: { type: 'object', properties: { dir: { type: 'string' } } },
    executionMode: 'parallel',
    execute: async ({ dir = '.' }) => {
      const abs = safe(dir);
      const lines = [];
      for (const name of (await readdir(abs)).sort()) {
        try {
          const s = await stat(path.join(abs, name));
          lines.push(`${s.isDirectory() ? 'd' : '-'} ${s.size}\t${name}`);
        } catch { lines.push(`? ?\t${name}`); }
      }
      return { output: lines.join('\n') || '(empty)' };
    },
  },
  {
    name: 'done',
    description: 'declare the task complete with a short summary. terminates the harness.',
    schema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    execute: async ({ summary }) => ({ output: `task done: ${summary.trim()}`, terminate: true }),
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function safe(rel) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root)) throw new Error(`path "${rel}" escapes harness root`);
  return abs;
}

// ─── validation ─────────────────────────────────────────────────────────────

function validate(tool, raw) {
  const schema = tool.schema ?? { type: 'object', properties: {} };
  const args = raw ?? {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error(`${tool.name}: args must be an object`);
  for (const k of schema.required ?? []) if (!(k in args)) throw new Error(`${tool.name}: missing arg "${k}"`);
  for (const [k, def] of Object.entries(schema.properties ?? {})) {
    if (!(k in args)) continue;
    const v = args[k];
    const expected = def.type;
    const actual = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    if (expected !== actual) throw new Error(`${tool.name}: arg "${k}" must be ${expected}, got ${actual}`);
  }
  return tool.prepareArguments ? tool.prepareArguments(args) : args;
}

// ─── parsing ────────────────────────────────────────────────────────────────
//
// model emits one or more fenced tool calls per response:
//
//   ```tool
//   { "name": "shell", "args": { "cmd": "ls -la" } }
//   ```
//
// legacy single-purpose fences also parse: ```sh, ```soul, ```note, ```done.

function parseCalls(response) {
  const calls = [];
  const re = /```([a-zA-Z_][\w-]*)\s*\r?\n([\s\S]*?)\r?\n```/g;
  let m, id = 1;
  while ((m = re.exec(response)) !== null) {
    const tag = m[1];
    const body = m[2].trim();
    if (tag === 'tool') {
      try {
        const obj = JSON.parse(body);
        const name = obj.name ?? obj.tool;
        if (!name) throw new Error('missing "name"');
        calls.push({ id: `t${id++}`, name, args: obj.args ?? obj.arguments ?? {} });
      } catch (err) {
        calls.push({ id: `t${id++}`, name: '__invalid__', args: { error: err.message, body } });
      }
    } else if (tag === 'sh') calls.push({ id: `t${id++}`, name: 'shell', args: { cmd: body } });
    else if (tag === 'soul') calls.push({ id: `t${id++}`, name: 'write_soul', args: { content: body } });
    else if (tag === 'note') calls.push({ id: `t${id++}`, name: 'append_soul', args: { note: body } });
    else if (tag === 'done') calls.push({ id: `t${id++}`, name: 'done', args: { summary: body } });
  }
  return calls;
}

// ─── dispatch ───────────────────────────────────────────────────────────────

async function runOne(call, ctx, hooks) {
  const tool = TOOL_BY_NAME.get(call.name);
  if (!tool) return { ...call, output: `tool not found: ${call.name}`, isError: true };

  if (hooks.before) {
    const r = await hooks.before({ call, tool, ctx });
    if (r?.block) return { ...call, output: `[blocked] ${r.reason ?? ''}`, isError: true };
  }

  let args;
  try { args = validate(tool, call.args); }
  catch (err) { return { ...call, output: `[validation] ${err.message}`, isError: true }; }

  let raw;
  try { raw = await tool.execute(args, { ...ctx, onPartial: (c) => ctx.log(`  | ${c}`) }); }
  catch (err) { return { ...call, output: `[error] ${err.message}`, isError: true }; }

  let result = { ...call, output: raw.output ?? '', terminate: !!raw.terminate, isError: false };
  if (hooks.after) {
    const r = await hooks.after({ call, tool, result, ctx });
    if (r) result = { ...result, ...r };
  }
  return result;
}

async function dispatch(response, ctx, hooks = {}) {
  const calls = parseCalls(response);
  if (calls.length === 0) {
    await ctx.log('[no tool calls in response]');
    return { results: [], terminate: false };
  }

  const sequential = calls.some((c) => TOOL_BY_NAME.get(c.name)?.executionMode === 'sequential');
  const results = [];

  if (sequential) {
    for (const call of calls) {
      await ctx.log(`--- ${call.name} ${JSON.stringify(call.args)} ---`);
      const r = await runOne(call, ctx, hooks);
      await ctx.log(`-> ${r.output}`);
      results.push(r);
      if (ctx.signal?.aborted) break;
    }
  } else {
    await ctx.log(`--- parallel: ${calls.map((c) => c.name).join(', ')} ---`);
    const settled = await Promise.all(calls.map((c) => runOne(c, ctx, hooks)));
    for (const r of settled) {
      await ctx.log(`-> ${r.name}: ${r.output}`);
      results.push(r);
    }
  }

  // terminate when every result asks for it (in practice: just the `done` tool).
  return { results, terminate: results.length > 0 && results.every((r) => r.terminate === true) };
}

// ─── prompt ─────────────────────────────────────────────────────────────────

const PROTOCOL = `
# how to act

each tick, emit one or more fenced tool calls. multiple calls per tick are fine.

\`\`\`tool
{ "name": "<tool>", "args": { ... } }
\`\`\`

call \`done\` only when the task is truly finished. the harness ticks until you do.
`.trim();

function describe(tools) {
  return tools.map((t) => {
    const args = Object.entries(t.schema?.properties ?? {})
      .map(([k, v]) => `${k}${(t.schema?.required ?? []).includes(k) ? '' : '?'}:${v.type}`)
      .join(', ');
    return `- ${t.name}(${args}) — ${t.description}`;
  }).join('\n');
}

async function readIfExists(p) {
  try { return await readFile(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}

async function buildPrompt({ task, tick }) {
  const [soul, last] = await Promise.all([readIfExists(SOUL), readIfExists(LAST)]);
  return [
    soul.trim(),
    PROTOCOL,
    `# tools\n${describe(TOOLS)}`,
    task && `# the task\n${task}`,
    last.trim() && `# last tick\n${last.trim()}`,
    `# tick ${tick}/${MAX_TICKS}`,
  ].filter(Boolean).join('\n\n');
}

// ─── ollama ─────────────────────────────────────────────────────────────────

async function callOllama({ prompt, signal }) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return ((await res.json()).response || '').trim();
}

// ─── log ────────────────────────────────────────────────────────────────────

async function log(line) {
  const stamped = typeof line === 'string' ? line : String(line);
  await appendFile(LOG, stamped + '\n', 'utf8').catch(() => {});
}

// ─── loop ───────────────────────────────────────────────────────────────────

async function main({ before, after } = {}) {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    console.error('usage: node src/index.js "your long-horizon task"');
    process.exit(1);
  }

  await log(`\n===== run @ ${new Date().toISOString()} =====`);
  await log(`task: ${task}`);

  const ctx = { log };

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    await log(`\n--- tick ${tick}/${MAX_TICKS} ---`);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TICK_TIMEOUT);
    let results = [];
    let terminate = false;

    try {
      const prompt = await buildPrompt({ task, tick });
      const response = await callOllama({ prompt, signal: abort.signal });
      await log(response);
      const out = await dispatch(response, { ...ctx, signal: abort.signal }, { before, after });
      results = out.results;
      terminate = out.terminate;
    } catch (err) {
      await log(`[tick error] ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const summary = results.map((r) => `${r.isError ? '!' : r.terminate ? '*' : '·'} ${r.name}\n${r.output}`).join('\n\n');
    await writeFile(LAST, summary + '\n', 'utf8').catch(() => {});

    if (terminate) {
      await log(`===== done after ${tick} ticks =====`);
      return;
    }
    if (TICK_DELAY > 0) await sleep(TICK_DELAY);
  }

  await log(`===== hit max ticks (${MAX_TICKS}) =====`);
}

main().catch((err) => { console.error(err); process.exit(1); });
