#!/usr/bin/env node
import { writeFile, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { buildPrompt } from './prompt.js';
import { callOllama } from './ollama.js';
import { processResponse } from './actions.js';
import { makeLogger } from './logger.js';

async function resolveTask(argTask, taskPath, log) {
  if (argTask && argTask.trim()) {
    await writeFile(taskPath, argTask.trim() + '\n', 'utf8');
    await log(`--- task set from argv ---\n${argTask.trim()}`);
    return argTask.trim();
  }
  try {
    const existing = (await readFile(taskPath, 'utf8')).trim();
    return existing;
  } catch {
    return '';
  }
}

async function runHarness() {
  const log = makeLogger(config.paths.log);
  const argTask = process.argv.slice(2).join(' ').trim();

  await log(`\n===== harness run @ ${new Date().toISOString()} =====`);
  const task = await resolveTask(argTask, config.paths.task, log);

  if (!task) {
    await log('[fatal] no task. pass one as argv or write task.md.');
    console.error('no task. usage: node src/index.js "your long-horizon task"');
    process.exit(1);
  }

  for (let tick = 1; tick <= config.maxTicks; tick++) {
    await log(`\n--- tick ${tick}/${config.maxTicks} @ ${new Date().toISOString()} ---`);

    let signal = { done: false };
    try {
      const prompt = await buildPrompt(config.paths, { tick, maxTicks: config.maxTicks });
      const response = await callOllama({
        url: config.ollamaUrl,
        model: config.model,
        prompt,
      });
      await log(response);
      signal = await processResponse(response, {
        memoryPath: config.paths.memory,
        log,
        commandTimeoutMs: config.commandTimeoutMs,
      });
    } catch (err) {
      await log(`[error] ${err.message}`);
    }

    if (signal.done) {
      await log(`===== harness stopped: task done after ${tick} ticks =====`);
      return;
    }

    if (config.tickDelayMs > 0) await sleep(config.tickDelayMs);
  }

  await log(`===== harness stopped: hit max ticks (${config.maxTicks}) =====`);
}

runHarness().catch((err) => {
  console.error(err);
  process.exit(1);
});
