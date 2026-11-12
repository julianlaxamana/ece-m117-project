"""Run AgentDojo with any current model (Anthropic, OpenAI, a local Ollama model, or the
`claude` CLI on a Claude subscription).

AgentDojo's built-in CLI only knows a fixed list of older models. This wrapper builds
the LLM element ourselves and hands it to AgentDojo's pipeline, so any model id works.

Examples:
    # Utility only (no attack) on 3 workspace tasks with a local model
    uv run run_benchmark.py --provider ollama --model qwen3-8b-16k --suite workspace -ut user_task_0 -ut user_task_1 -ut user_task_2

    # With an attack and a defense
    uv run run_benchmark.py --provider anthropic --model claude-haiku-5-5 --suite workspace \
        --attack important_instructions --defense spotlighting_with_delimiting

    # Through the `claude` CLI (subscription login, no API key); see claude_cli_llm.py
    uv run run_benchmark.py --provider claude-cli --model claude-haiku-5-5 --suite workspace -ut user_task_0
"""

import os
from pathlib import Path

import click
from dotenv import load_dotenv

from agentdojo.agent_pipeline import AgentPipeline, PipelineConfig
from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement
from agentdojo.attacks.attack_registry import load_attack
from agentdojo.benchmark import (
    SuiteResults,
    benchmark_suite_with_injections,
    benchmark_suite_without_injections,
)
from agentdojo.logging import OutputLogger
from agentdojo.models import MODEL_NAMES
from agentdojo.task_suite.load_suites import get_suite

BENCHMARK_VERSION = "v1.2"


def build_llm(provider: str, model: str, reasoning_effort: str | None = None) -> BasePipelineElement:
    if provider == "ollama" and reasoning_effort is None:
        # Qwen3 etc. "think" for minutes per step by default; "none" disables it.
        reasoning_effort = "none"
    if provider == "anthropic":
        import anthropic

        from agentdojo.agent_pipeline.llms.anthropic_llm import AnthropicLLM

        llm = AnthropicLLM(anthropic.Anthropic(), model)
        prose_name = "Claude"
    elif provider == "openai":
        import openai

        from agentdojo.agent_pipeline.llms.openai_llm import OpenAILLM

        llm = OpenAILLM(openai.OpenAI(), model, reasoning_effort=reasoning_effort)
        prose_name = "GPT-4"
    elif provider == "ollama":
        import openai

        from agentdojo.agent_pipeline.llms.openai_llm import OpenAILLM

        host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        client = openai.OpenAI(base_url=f"{host}/v1", api_key="ollama")
        llm = OpenAILLM(client, model, reasoning_effort=reasoning_effort)
        prose_name = "AI assistant"
    elif provider == "claude-cli":
        # Claude Code CLI with its system prompt and tools stripped; see claude_cli_llm.py.
        from claude_cli_llm import make_claude_cli_llm

        if reasoning_effort is not None:
            raise click.BadParameter("--reasoning-effort isn't supported with claude-cli")
        llm = make_claude_cli_llm(model)
        prose_name = "Claude"
    else:
        raise click.BadParameter(f"unknown provider {provider}")

    # The name is also the results directory under runs/, so different reasoning
    # settings don't overwrite each other's cached results.
    llm.name = model if reasoning_effort is None else f"{model}-reasoning-{reasoning_effort}"
    if provider == "claude-cli":  # keep apart from the same model run through the API
        llm.name = f"{model}-via-cli"
    # Attacks like `important_instructions` address the model by name ("This is a message
    # to Claude..."). AgentDojo looks that up in a hardcoded table, so register our model.
    MODEL_NAMES.setdefault(model, prose_name)
    llm.model_id = model  # the real id; llm.name may carry a suffix
    llm.reasoning_effort_used = reasoning_effort
    return llm


class _ClientWithDefaults:
    """An OpenAI client stand-in that adds default kwargs to chat.completions.create."""

    def __init__(self, client, **defaults):
        create = client.chat.completions.create
        completions = type("Completions", (), {"create": staticmethod(lambda **kw: create(**{**defaults, **kw}))})
        self.chat = type("Chat", (), {"completions": completions})()


def build_pipeline(llm: BasePipelineElement, defense: str | None) -> AgentPipeline:
    pipeline = AgentPipeline.from_config(
        PipelineConfig(llm=llm, model_id=None, defense=defense, system_message_name=None, system_message=None)
    )
    # AgentDojo's tool_filter defense calls the API with the pipeline's display name as the
    # model id (404 when the name has our suffix) and without reasoning settings (so Qwen
    # would "think" for minutes). Point it at the real model with the same settings.
    from agentdojo.agent_pipeline.llms.openai_llm import OpenAILLMToolFilter

    for element in pipeline.elements:
        if isinstance(element, OpenAILLMToolFilter):
            element.model = llm.model_id
            if llm.reasoning_effort_used is not None:
                element.client = _ClientWithDefaults(element.client, reasoning_effort=llm.reasoning_effort_used)
    return pipeline


def summarize(results: SuiteResults, attacked: bool) -> str:
    u = list(results["utility_results"].values())
    lines = [f"  utility: {sum(u)}/{len(u)} = {100 * sum(u) / max(len(u), 1):.1f}%"]
    if attacked:
        s = list(results["security_results"].values())
        # In AgentDojo, security_results[...] == True means the injection task SUCCEEDED.
        lines.append(f"  attack success rate (ASR): {sum(s)}/{len(s)} = {100 * sum(s) / max(len(s), 1):.1f}%")
    return "\n".join(lines)


@click.command()
@click.option("--provider", type=click.Choice(["anthropic", "openai", "ollama", "claude-cli"]), required=True)
@click.option("--model", required=True, help="Model id, e.g. claude-haiku-5-5 or qwen3:8b")
@click.option("--suite", "suites", multiple=True, default=("workspace",),
              help="workspace, travel, banking, slack (repeatable)")
@click.option("-ut", "--user-task", "user_tasks", multiple=True, help="Limit to these user tasks")
@click.option("-it", "--injection-task", "injection_tasks", multiple=True, help="Limit to these injection tasks")
@click.option("--attack", default=None, help="e.g. important_instructions, ignore_previous, tool_knowledge")
@click.option("--defense", default=None,
              help="spotlighting_with_delimiting, repeat_user_prompt, tool_filter (openai/ollama only), "
                   "transformers_pi_detector (needs `uv add 'agentdojo[transformers]'`)")
@click.option("--reasoning-effort", default=None,
              help="openai/ollama: none|low|medium|high. Ollama defaults to none (thinking off).")
@click.option("--logdir", type=Path, default=Path("runs"))
@click.option("--force-rerun", is_flag=True, help="Ignore cached results in --logdir")
def main(provider, model, suites, user_tasks, injection_tasks, attack, defense, reasoning_effort, logdir,
         force_rerun):
    load_dotenv(".env")
    llm = build_llm(provider, model, reasoning_effort)
    pipeline = build_pipeline(llm, defense)

    for suite_name in suites:
        suite = get_suite(BENCHMARK_VERSION, suite_name)
        click.echo(f"\n=== {suite_name} | {model} | attack={attack} | defense={defense} ===")
        with OutputLogger(str(logdir)):
            if attack is None:
                results = benchmark_suite_without_injections(
                    pipeline, suite, logdir=logdir, force_rerun=force_rerun,
                    user_tasks=user_tasks or None, benchmark_version=BENCHMARK_VERSION,
                )
            else:
                attacker = load_attack(attack, suite, pipeline)
                results = benchmark_suite_with_injections(
                    pipeline, suite, attacker, logdir=logdir, force_rerun=force_rerun,
                    user_tasks=user_tasks or None, injection_tasks=injection_tasks or None,
                    benchmark_version=BENCHMARK_VERSION,
                )
        click.echo(summarize(results, attacked=attack is not None))


if __name__ == "__main__":
    main()
