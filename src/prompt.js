import { readFile } from 'node:fs/promises';

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

export async function buildPrompt(paths, { tick, maxTicks } = {}) {
  const [soul, heartbeat, memory, task] = await Promise.all([
    readIfExists(paths.soul),
    readIfExists(paths.heartbeat),
    readIfExists(paths.memory),
    readIfExists(paths.task),
  ]);

  const sections = [
    soul.trim(),
    task.trim() && `# the task\n${task.trim()}`,
    memory.trim() && `# memory\n${memory.trim()}`,
    heartbeat.trim(),
    tick != null && `# tick ${tick} of ${maxTicks}`,
  ];

  return sections.filter(Boolean).join('\n\n');
}
