"""Run ONE AgentDojo task and stream what happens as JSON lines on stdout.

Used by the viewer's live page (viz/app/live). Uses only AgentDojo's built-in attacks
and defenses. Each run is also saved to runs/ like run_benchmark.py does.

    uv run stream_run.py options
    uv run stream_run.py run '{"provider":"ollama","model":"qwen3-8b-16k","suite":"banking",
        "user_task":"user_task_0","injection_task":"injection_task_0",
        "attack":"important_instructions","defense":null}'

Events (one JSON object per line):
    {"type": "status",  "text": ...}
    {"type": "start",   "pipeline": ..., "injections": {vector: text}, ...}
    {"type": "message", "message": <AgentDojo chat message>}
    {"type": "thinking"}                       # target LLM call in progress
    {"type": "result",  "utility": bool, "security": bool | null, "duration": s, "log": path}
    {"type": "error",   "text": ...}
"""

import json
import os
import shutil
import signal
import sys
import time
import traceback
from pathlib import Path

from dotenv import load_dotenv

# AgentDojo and rich print to stdout; keep stdout clean for our events.
_events = sys.stdout
sys.stdout = sys.stderr

from agentdojo.agent_pipeline.agent_pipeline import DEFENSES  # noqa: E402
from agentdojo.attacks.attack_registry import ATTACKS, load_attack  # noqa: E402
from agentdojo.benchmark import run_task_with_injection_tasks, run_task_without_injection_tasks  # noqa: E402
from agentdojo.logging import OutputLogger  # noqa: E402
from agentdojo.task_suite.load_suites import get_suite, get_suites  # noqa: E402

from run_benchmark import BENCHMARK_VERSION, build_llm, build_pipeline  # noqa: E402

LOGDIR = Path("runs")
# DoS attacks have no attacker goal to check, and "manual" asks for input on the terminal.
ATTACK_NAMES = sorted(
    name for name, cls in ATTACKS.items() if not getattr(cls, "is_dos_attack", False) and name != "manual"
)


def available_defenses() -> list[str]:
    try:
        import transformers  # noqa: F401

        return list(DEFENSES)
    except ImportError:  # the PI detector needs `uv add 'agentdojo[transformers]'`
        return [d for d in DEFENSES if d != "transformers_pi_detector"]


def _jsonable(o):
    if hasattr(o, "model_dump"):  # pydantic objects such as FunctionCall
        return o.model_dump(mode="json")
    return str(o)


def emit(event: dict) -> None:
    _events.write(json.dumps(event, default=_jsonable) + "\n")
    _events.flush()


def options() -> None:
    suites = {}
    for name, suite in get_suites(BENCHMARK_VERSION).items():
        suites[name] = {
            "user_tasks": [{"id": t.ID, "prompt": t.PROMPT} for t in suite.user_tasks.values()],
            "injection_tasks": [{"id": t.ID, "goal": t.GOAL} for t in suite.injection_tasks.values()],
        }
    emit({"type": "options", "suites": suites, "attacks": ATTACK_NAMES, "defenses": available_defenses()})


def stream_llm_calls(llm, sent: list[int]) -> None:
    """Patch the LLM element so every message is emitted as soon as it exists.

    Before each LLM call we emit messages the agent hasn't shown yet (system prompt,
    user prompt, tool results); after it we emit the model's reply. Patching the
    instance (instead of wrapping it) keeps isinstance checks in AgentDojo working.
    """
    original = llm.query

    def flush(messages):
        for m in messages[sent[0]:]:
            emit({"type": "message", "message": m})
        sent[0] = len(messages)

    def query(query, runtime, env, messages=[], extra_args={}):
        flush(messages)
        emit({"type": "thinking"})
        result = original(query, runtime, env, messages, extra_args)
        flush(result[3])
        return result

    llm.query = query


def run(cfg: dict) -> None:
    suite = get_suite(BENCHMARK_VERSION, cfg["suite"])
    user_task = suite.get_user_task_by_id(cfg["user_task"])
    attack_name = cfg.get("attack") or None
    defense = cfg.get("defense") or None
    if attack_name is not None and attack_name not in ATTACK_NAMES:
        raise ValueError(f"unknown attack {attack_name}")
    if defense is not None and defense not in available_defenses():
        raise ValueError(f"unknown defense {defense}")

    emit({"type": "status", "text": "Building pipeline"})
    llm = build_llm(cfg["provider"], cfg["model"], cfg.get("reasoning_effort"))
    pipeline = build_pipeline(llm, defense)
    sent = [0]
    stream_llm_calls(llm, sent)

    injections: dict[str, str] = {}
    attack = None
    if attack_name is not None:
        injection_task = suite.get_injection_task_by_id(cfg["injection_task"])
        attack = load_attack(attack_name, suite, pipeline)
        emit({"type": "status", "text": "Finding where the payload can be planted"})
        injections = attack.attack(user_task, injection_task)

    emit({
        "type": "start",
        "pipeline": pipeline.name,
        "suite": suite.name,
        "user_task": user_task.ID,
        "user_prompt": user_task.PROMPT,
        "injection_task": cfg.get("injection_task") if attack_name else None,
        "attack": attack_name,
        "defense": defense,
        "injections": injections,
    })

    # Write to a scratch folder and move the log into runs/ only once the run finishes, so
    # stopping a rerun halfway can't overwrite an earlier complete result with a partial one.
    scratch = LOGDIR / ".live" / str(os.getpid())
    t0 = time.time()
    try:
        with OutputLogger(str(scratch)):
            if attack is None:
                utility, _ = run_task_without_injection_tasks(
                    suite, pipeline, user_task, logdir=scratch, force_rerun=True, benchmark_version=BENCHMARK_VERSION
                )
                security = None
                rel = Path(pipeline.name, suite.name, user_task.ID, "none", "none.json")
            else:
                utils, secs = run_task_with_injection_tasks(
                    suite, pipeline, user_task, attack, logdir=scratch, force_rerun=True,
                    injection_tasks=[cfg["injection_task"]], benchmark_version=BENCHMARK_VERSION,
                )
                key = (user_task.ID, cfg["injection_task"])
                utility, security = utils[key], secs[key]
                rel = Path(pipeline.name, suite.name, user_task.ID, attack_name, f"{cfg['injection_task']}.json")
        log = LOGDIR / rel
        log.parent.mkdir(parents=True, exist_ok=True)
        (scratch / rel).replace(log)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    # The final reply is produced by the last LLM call, so it was already emitted.
    emit({"type": "result", "utility": utility, "security": security, "duration": time.time() - t0, "log": str(log)})


def main() -> None:
    load_dotenv(".env")
    # The viewer's Stop button sends SIGTERM; exit normally so cleanup (finally blocks) runs.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        if sys.argv[1:2] == ["options"]:
            options()
        elif sys.argv[1:2] == ["run"] and len(sys.argv) == 3:
            run(json.loads(sys.argv[2]))
        else:
            raise SystemExit(__doc__)
    except Exception as e:  # report to the UI instead of dying silently
        traceback.print_exc()
        emit({"type": "error", "text": f"{type(e).__name__}: {e}"})
        sys.exit(1)


if __name__ == "__main__":
    main()
