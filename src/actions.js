import { writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function extractFence(text, tag) {
  const pattern = new RegExp('```' + tag + '\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```', 'm');
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

async function runShell(cmd, { log, timeoutMs }) {
  await log('--- running command ---');
  await log(`$ ${cmd}`);
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
    if (stdout.trim()) await log(stdout.trimEnd());
    if (stderr.trim()) await log(`[stderr] ${stderr.trimEnd()}`);
  } catch (err) {
    await log(`[error] ${err.message}`);
  }
}

async function updateMemory(content, { memoryPath, log }) {
  await writeFile(memoryPath, content + '\n', 'utf8');
  await log('--- memory updated ---');
}

export async function processResponse(response, { memoryPath, log, commandTimeoutMs }) {
  const shell = extractFence(response, 'sh');
  if (shell) await runShell(shell, { log, timeoutMs: commandTimeoutMs });

  const memory = extractFence(response, 'memory');
  if (memory !== null) await updateMemory(memory, { memoryPath, log });
}
