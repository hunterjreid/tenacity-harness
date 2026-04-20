import { appendFile } from 'node:fs/promises';

export function makeLogger(logPath) {
  return async function log(line) {
    const text = line == null ? '' : String(line);
    await appendFile(logPath, text + '\n', 'utf8');
  };
}
