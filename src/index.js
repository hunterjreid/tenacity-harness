#!/usr/bin/env node
import { config } from './config.js';
import { buildPrompt } from './prompt.js';
import { callOllama } from './ollama.js';
import { processResponse } from './actions.js';
import { makeLogger } from './logger.js';

async function tick() {
  const log = makeLogger(config.paths.log);
  await log(`=== ${new Date().toISOString()} ===`);

  try {
    const prompt = await buildPrompt(config.paths);
    const response = await callOllama({
      url: config.ollamaUrl,
      model: config.model,
      prompt,
    });

    await log(response);
    await processResponse(response, {
      memoryPath: config.paths.memory,
      log,
      commandTimeoutMs: config.commandTimeoutMs,
    });
  } catch (err) {
    await log(`[fatal] ${err.message}`);
    process.exitCode = 1;
  }

  await log('');
}

tick();
