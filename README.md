thrumloom is a tiny autonomous llm agent that wakes up on a heartbeat, reads three markdown files, asks a local ollama model what to do, and goes back to sleep. it has no framework and no dependencies beyond node 20 and a working ollama install.

the three files are soul.md for identity, heartbeat.md for the recurring prompt, and memory.md for whatever the agent wants to carry forward. everything the model says is appended to log.txt, so nothing is ever lost.

the agent only does two kinds of things. if the model writes a fenced sh block it gets executed via the system shell, with stdout and stderr piped into the log. if the model writes a fenced memory block, memory.md is overwritten with its contents.

there is also a fenced note block, which appends a single timestamped line to memory.md instead of overwriting it. use it for quick observations the agent wants to remember without rewriting everything it already knows.

install ollama, pull a small model like llama3.2, clone the repo, and run node src/index.js to fire a single heartbeat. hook src/index.js into cron or task scheduler to have it tick on whatever rhythm you like. the default model name is llama3.2, the default ollama endpoint is http://localhost:11434, and the default per-command timeout is sixty seconds; override them with THRUMLOOM_MODEL, OLLAMA_URL, and THRUMLOOM_CMD_TIMEOUT_MS respectively.

remember that anything the model emits in a sh block runs with the privileges of whoever launched the heartbeat, so keep soul.md strict, keep the model small, and do not run this as root. the log is the only source of truth for what the agent has been up to. read it.
