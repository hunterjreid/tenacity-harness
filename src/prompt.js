import { readFile } from 'node:fs/promises';

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

export async function buildPrompt(paths) {
  const parts = await Promise.all([
    readIfExists(paths.soul),
    readIfExists(paths.heartbeat),
    readIfExists(paths.memory),
  ]);
  return parts.map((s) => s.trim()).filter(Boolean).join('\n\n');
}
