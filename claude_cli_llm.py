"""Use the `claude` CLI (Claude Code, signed in with a subscription) as an AgentDojo model.

`claude -p` runs Claude Code's own agent, so we strip it down to a bare model:
  --system-prompt   replaces Claude Code's default system prompt (and its injection guidance)
  --tools ""        turns off Claude Code's built-in tools
  --strict-mcp-config, --setting-sources ""   no MCP servers, hooks, plugins or settings
  cwd = empty temp dir   no CLAUDE.md or project memory gets picked up

The CLI can't take AgentDojo's tools natively, so tool calling is done through the prompt
with AgentDojo's own PromptingLLM (the scheme the AgentDojo paper used for Llama 3): tools
are described in the system prompt, the model writes <function-call>[f(a=1)]</function-call>,
and tool results come back as <function-result> user turns.

Differences from the `anthropic` provider, worth noting in results:
  - tool calls are prompted text, not native tool use
  - the conversation so far is sent as one transcript per call (the CLI takes one prompt)
  - temperature can't be set
  - subscription requests may still carry a short Claude Code identity line
"""

import json
import os
import shutil
import subprocess
import tempfile
from types import SimpleNamespace

from openai.types.chat import ChatCompletionMessage

from agentdojo.agent_pipeline.llms.prompting_llm import PromptingLLM

# Make the CLI use the subscription login, not an API key or gateway picked up from .env.
_STRIP_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL")


def _text(content) -> str:
    if isinstance(content, str):
        return content
    return "".join(part.get("text", "") for part in content or [])


def _to_prompt(messages: list[dict]) -> tuple[str, str]:
    """Split OpenAI-style messages into (system prompt, user prompt)."""
    system = "\n\n".join(_text(m["content"]) for m in messages if m["role"] in ("system", "developer"))
    turns = [m for m in messages if m["role"] not in ("system", "developer")]
    if len(turns) == 1 and turns[0]["role"] == "user":
        return system, _text(turns[0]["content"])
    # Multi-turn: the CLI takes a single prompt, so send the history as a transcript.
    body = "\n\n".join(f'<turn role="{m["role"]}">\n{_text(m["content"])}\n</turn>' for m in turns)
    prompt = (
        "Below is the conversation so far. Write ONLY the assistant's next turn, "
        "following the format from your instructions.\n\n" + body
    )
    return system, prompt


class _Completions:
    def __init__(self, timeout: float):
        self.timeout = timeout
        self.workdir = tempfile.mkdtemp(prefix="claude-cli-agentdojo-")
        self.env = {k: v for k, v in os.environ.items() if k not in _STRIP_ENV}

    def create(self, model: str, messages, **_ignored):  # tools/temperature aren't supported
        system, prompt = _to_prompt(list(messages))
        cmd = [
            "claude", "-p",
            "--model", model,
            "--system-prompt", system or "You are a helpful assistant.",
            "--tools", "",
            "--strict-mcp-config",
            "--setting-sources", "",
            "--no-session-persistence",
            "--output-format", "json",
        ]
        proc = subprocess.run(
            cmd, input=prompt, capture_output=True, text=True,
            cwd=self.workdir, env=self.env, timeout=self.timeout,
        )
        try:
            out = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise RuntimeError(f"claude CLI failed (exit {proc.returncode}): {proc.stderr or proc.stdout}") from None
        if out.get("is_error"):
            raise RuntimeError(f"claude CLI error: {out.get('result')}")
        message = ChatCompletionMessage(role="assistant", content=out.get("result") or "")
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class ClaudeCLIClient:
    """Stands in for an OpenAI client: chat.completions.create runs `claude -p`."""

    def __init__(self, timeout: float = 600):
        if shutil.which("claude") is None:
            raise RuntimeError("`claude` CLI not found on PATH")
        self.chat = SimpleNamespace(completions=_Completions(timeout))


def make_claude_cli_llm(model: str) -> PromptingLLM:
    return PromptingLLM(ClaudeCLIClient(), model)
