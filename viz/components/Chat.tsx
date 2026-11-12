import type { ReactNode } from "react";
import { argFromAttacker, splitByInjections } from "@/lib/highlight";
import { textOf, type Message, type RunLog, type ToolCall } from "@/lib/runs";
import { Replay } from "./Replay";

type Ctx = { injections: Record<string, string>; userPrompt: string };

function Avatar({ label, className }: { label: string; className: string }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${className}`}
      aria-hidden
    >
      {label}
    </div>
  );
}

function Row({ side, avatar, name, children }: { side: "left" | "right"; avatar: ReactNode; name: string; children: ReactNode }) {
  return (
    <div className={`flex gap-3 ${side === "right" ? "flex-row-reverse" : ""}`}>
      {avatar}
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${side === "right" ? "items-end" : "items-start"}`}>
        <div className="text-xs text-muted">{name}</div>
        {children}
      </div>
    </div>
  );
}

function AttackerCard({ vector, payload }: { vector: string; payload: string }) {
  return (
    <Row side="left" name="Attacker" avatar={<Avatar label="ATK" className="bg-attacker text-white" />}>
      <div className="w-full rounded-2xl rounded-tl-sm border border-attacker/40 bg-attacker-soft px-4 py-3">
        <div className="mb-2 text-sm">
          Planted a payload in <code className="rounded bg-surface/60 px-1 font-mono text-xs">{vector}</code>.
          The target never sees this directly: it will show up inside a tool result.
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-attacker">
          {payload.trim()}
        </pre>
      </div>
    </Row>
  );
}

function SystemPrompt({ text }: { text: string }) {
  return (
    <details className="rounded-lg border border-dashed border-border px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted">System prompt given to the target agent</summary>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted">{text}</pre>
    </details>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <Row side="right" name="User" avatar={<Avatar label="USR" className="bg-user text-white" />}>
      <div className="rounded-2xl rounded-tr-sm bg-user-bg px-4 py-2.5 text-sm whitespace-pre-wrap">{text}</div>
    </Row>
  );
}

function ArgValue({ value, ctx }: { value: unknown; ctx: Ctx }) {
  const shown = JSON.stringify(value);
  if (argFromAttacker(value, ctx.injections, ctx.userPrompt)) {
    return (
      <span
        className="rounded bg-attacker-soft px-1 text-attacker underline decoration-wavy underline-offset-2"
        title="This value appears in the attacker's payload but not in the user's request"
      >
        {shown}
      </span>
    );
  }
  return <span>{shown}</span>;
}

function ToolCallLine({ call, ctx }: { call: ToolCall; ctx: Ctx }) {
  const args = Object.entries(call.args ?? {});
  return (
    <div className="font-mono text-xs leading-relaxed">
      <span className="text-muted">→ </span>
      <span className="font-semibold">{call.function}</span>(
      {args.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ", "}
          <span className="text-muted">{k}=</span>
          <ArgValue value={v} ctx={ctx} />
        </span>
      ))}
      )
    </div>
  );
}

function AgentBubble({ msg, ctx }: { msg: Extract<Message, { role: "assistant" }>; ctx: Ctx }) {
  const text = textOf(msg.content).trim();
  const calls = msg.tool_calls ?? [];
  const thinking =
    Array.isArray(msg.content) &&
    msg.content
      .filter((b) => b.type !== "text")
      .map((b) => (typeof b.content === "string" ? b.content : ""))
      .join("\n")
      .trim();
  return (
    <Row side="left" name="Target agent" avatar={<Avatar label="AI" className="bg-foreground text-background" />}>
      <div className="w-full rounded-2xl rounded-tl-sm border border-border bg-agent-bg px-4 py-2.5 text-sm">
        {thinking && (
          <details className="mb-2">
            <summary className="cursor-pointer text-xs text-muted">Reasoning</summary>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted">{thinking}</pre>
          </details>
        )}
        {text && <div className="whitespace-pre-wrap">{text}</div>}
        {calls.length > 0 && (
          <div className={`flex flex-col gap-1 ${text ? "mt-2 border-t border-border pt-2" : ""}`}>
            {calls.map((c, i) => (
              <ToolCallLine key={c.id ?? i} call={c} ctx={ctx} />
            ))}
          </div>
        )}
        {!text && calls.length === 0 && <div className="italic text-muted">(empty response)</div>}
      </div>
    </Row>
  );
}

function ToolResult({ msg, ctx }: { msg: Extract<Message, { role: "tool" }>; ctx: Ctx }) {
  const text = textOf(msg.content);
  const segments = splitByInjections(text, ctx.injections);
  const poisoned = segments.some((s) => s.injected);
  return (
    <div className="ml-11 max-w-[85%]">
      <div
        className={`overflow-hidden rounded-lg border bg-tool-bg ${poisoned ? "border-attacker/60" : "border-border"}`}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
          <span>⚙ Tool result</span>
          {msg.tool_call && <code className="font-mono">{msg.tool_call.function}</code>}
          {poisoned && (
            <span className="ml-auto rounded-full bg-attacker px-2 py-0.5 text-[10px] font-semibold text-white">
              contains attacker payload
            </span>
          )}
          {msg.error && (
            <span className="ml-auto rounded-full bg-bad px-2 py-0.5 text-[10px] font-semibold text-white">error</span>
          )}
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed">
          {segments.map((s, i) =>
            s.injected ? (
              <mark
                key={i}
                className="box-decoration-clone rounded-sm bg-attacker-soft px-0.5 text-attacker"
                title="Text planted by the attacker"
              >
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
          {msg.error && <span className="text-bad">{`\n${msg.error}`}</span>}
        </pre>
      </div>
    </div>
  );
}

function Verdict({ run }: { run: RunLog }) {
  const attacked = run.attack_type && run.attack_type !== "none";
  return (
    <div className="mt-2 grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
      <Pill
        ok={run.utility ?? null}
        label="User's task"
        yes="Completed"
        no="Not completed"
      />
      {attacked ? (
        <Pill
          ok={run.security == null ? null : !run.security}
          label="Attack"
          yes="Resisted: attacker goal not achieved"
          no="Succeeded: agent carried out the attacker's goal"
        />
      ) : (
        <div className="text-sm text-muted">No attack in this run.</div>
      )}
      {run.error && <div className="text-sm text-bad sm:col-span-2">Run error: {run.error}</div>}
    </div>
  );
}

function Pill({ ok, label, yes, no }: { ok: boolean | null; label: string; yes: string; no: string }) {
  const cls = ok == null ? "bg-tool-bg text-muted" : ok ? "bg-good-bg text-good" : "bg-bad-bg text-bad";
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${cls}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="font-medium">{ok == null ? "Unknown" : ok ? yes : no}</div>
    </div>
  );
}

export function Chat({ run }: { run: RunLog }) {
  const userPrompt = run.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n");
  const ctx: Ctx = { injections: run.injections ?? {}, userPrompt };
  const system = run.messages.find((m) => m.role === "system");

  const items: ReactNode[] = [];
  if (system) items.push(<SystemPrompt key="sys" text={textOf(system.content)} />);
  for (const [vector, payload] of Object.entries(ctx.injections)) {
    items.push(<AttackerCard key={`atk-${vector}`} vector={vector} payload={payload} />);
  }
  run.messages.forEach((m, i) => {
    if (m.role === "user") items.push(<UserBubble key={i} text={textOf(m.content)} />);
    else if (m.role === "assistant") items.push(<AgentBubble key={i} msg={m} ctx={ctx} />);
    else if (m.role === "tool") items.push(<ToolResult key={i} msg={m} ctx={ctx} />);
  });
  items.push(<Verdict key="verdict" run={run} />);

  return <Replay>{items}</Replay>;
}
