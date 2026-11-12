# Agentic Red Teaming and Defense Against Prompt Injections

ECE M117 project. Testbed: [AgentDojo](https://github.com/ethz-spylab/agentdojo) (v0.1.35, benchmark v1.2).

## Setup

```bash
uv sync                 # creates .venv with Python 3.12 + AgentDojo
cp .env.example .env    # add API keys you have
```

For a free local model via Ollama, pull one that supports tool calling, then build the 16k-context variant (Ollama's 4k default silently truncates AgentDojo conversations):

```bash
ollama pull qwen3:8b
ollama create qwen3-8b-16k -f ollama/qwen3-8b-16k.Modelfile
```

For Ollama models the script turns thinking off by default (`--reasoning-effort none`); Qwen3's thinking mode takes minutes per step. Pass `--reasoning-effort high` to compare. Runs with a non-default setting are logged under a separate name in `runs/`.

With thinking off, qwen3-8b-16k takes ~20–40 s per agent run on an Apple Silicon GPU.

## Running

`run_benchmark.py` wraps AgentDojo so any current model id works (the built-in CLI only knows older models).

```bash
# Utility only (no attack), a few tasks — cheap first test
uv run run_benchmark.py --provider ollama --model qwen3-8b-16k --suite banking -ut user_task_0 -ut user_task_1

# Under attack
uv run run_benchmark.py --provider ollama --model qwen3-8b-16k --suite banking --attack important_instructions

# Under attack, with a defense
uv run run_benchmark.py --provider anthropic --model claude-haiku-5-5 --suite banking \
    --attack important_instructions --defense spotlighting_with_delimiting
```

Results are cached as JSON under `runs/` (rerun with `--force-rerun`).

### Metrics
- **Utility**: fraction of user tasks the agent completed correctly.
- **ASR (attack success rate)**: fraction of (user task, injection task) pairs where the injected goal was achieved. Lower is better.

### Options
| | Values |
|---|---|
| `--suite` | `workspace` (email/calendar/drive), `travel`, `banking`, `slack` |
| `--attack` | `important_instructions` (strongest baseline), `ignore_previous`, `system_message`, `injecagent`, `tool_knowledge`, `direct` |
| `--defense` | `spotlighting_with_delimiting`, `repeat_user_prompt`, `tool_filter` (OpenAI/Ollama only), `transformers_pi_detector` (needs `uv add 'agentdojo[transformers]'`) |

### Cost
A full suite under attack is (user tasks × injection tasks) agent runs, e.g. banking = 16 × 9 = 144 runs. Start with `-ut`/`-it` to limit scope before running whole suites on paid APIs.

## Known issues
- `python -m agentdojo.scripts.check_suites` reports every user task as "not injectable". This is a bug in AgentDojo's checker (it ignores tool outputs in content-block format); the injections do reach the agent.
- The checker also reports that ground truth fails for **workspace injection tasks 6–13** (new in v1.2). Their ASR numbers may be unreliable. Prefer `-it injection_task_0` … `injection_task_5` for workspace, or use the other suites.

## Viewer (Next.js)

`viz/` is a local web app that shows each run as a chat between the **attacker** (the planted payload), the **user**, the **target agent**, and its **tool results**. Planted text is highlighted inside tool outputs, and tool-call arguments that came from the payload (e.g. the attacker's IBAN) are flagged. It has a summary table (utility / attack success per model × defense × attack) and a step-by-step **Replay** for presenting.

```bash
cd viz && npm install && npm run dev   # http://localhost:3000
```

It reads `../runs` on every request (set `RUNS_DIR` to point elsewhere), so new benchmark results show up on refresh.

### Live page

`/live` runs one task at a time from the browser and streams it like a chat: the attacker's planted payload, each target-agent step (with a typing indicator while the model works), tool results, any messages a defense adds, and the final verdict. Pick the suite, user task, one of AgentDojo's built-in attacks, the attacker goal (injection task) and a defense, then press **Run** (**Stop** kills the run).

Under the hood the page calls `POST /api/run`, which starts `stream_run.py` and streams its JSON-lines events. Finished runs are saved to `runs/` like benchmark runs; a stopped run is discarded, so it never overwrites an earlier result. The dev server listens on 127.0.0.1 only, since this endpoint starts processes on your machine.

Results vary between identical runs (in testing, the same `tool_filter` run flipped between hijacked and resisted), so repeat runs before drawing conclusions.
