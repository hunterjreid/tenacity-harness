import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const config = {
  root,
  paths: {
    soul: path.join(root, 'soul.md'),
    heartbeat: path.join(root, 'heartbeat.md'),
    memory: path.join(root, 'memory.md'),
    log: path.join(root, 'log.txt'),
  },
  model: process.env.THRUMLOOM_MODEL || 'llama3.2',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  commandTimeoutMs: Number(process.env.THRUMLOOM_CMD_TIMEOUT_MS || 60_000),
};
