# thrumloom

A tiny autonomous LLM agent that runs on a heartbeat. No framework, no dependencies — just Node.js and a local [Ollama](https://ollama.com) install.

Every time the heartbeat fires, the agent reads its identity, its instructions, and its memory, asks a local model what to do, and optionally runs a shell command or rewrites its memory.

## files

| file | purpose |
| --- | --- |
| `soul.md` | identity and behavioural rules |
| `heartbeat.md` | the prompt sent to the model on every tick |
| `memory.md` | persistent memory — the model may overwrite this |
| `log.txt` | append-only transcript of every tick |
| `src/index.js` | entry point — wires everything together |
| `src/prompt.js` | builds the prompt from the three markdown files |
| `src/ollama.js` | calls the local Ollama HTTP API |
| `src/actions.js` | parses fenced blocks and runs shell / updates memory |
| `src/logger.js` | append-only logger |
| `src/config.js` | paths, model name, environment overrides |

## setup

```bash
# 1. install ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. pull a model
ollama pull llama3.2

# 3. clone and enter this repo
git clone https://github.com/hunterjreid/thrumloom.git
cd thrumloom

# 4. optional: override the model
export THRUMLOOM_MODEL=llama3.2
```

Node 20 or newer is required.

## running

One-shot tick:

```bash
node src/index.js
```

Schedule it every 30 minutes with cron:

```cron
*/30 * * * * /usr/bin/node /path/to/thrumloom/src/index.js
```

On Windows, use Task Scheduler to run the same command.

## how the agent acts

The agent's output is logged verbatim. Two fenced-block conventions turn text into action:

- ` ```sh ` — the block contents are executed via the system shell; stdout and stderr are appended to `log.txt`.
- ` ```memory ` — the block contents fully replace `memory.md`.

Anything outside those blocks is ignored, so the model can freely think out loud.

## environment variables

| var | default | purpose |
| --- | --- | --- |
| `THRUMLOOM_MODEL` | `llama3.2` | Ollama model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama HTTP endpoint |
| `THRUMLOOM_CMD_TIMEOUT_MS` | `60000` | per-command timeout for `sh` blocks |

## safety

The agent runs shell commands with the privileges of whoever starts it. Read `soul.md` carefully, keep the model small, review `log.txt` regularly, and don't run this as root.

## license

MIT — see [LICENSE](./LICENSE).
