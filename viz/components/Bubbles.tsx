/**
 * Chat building blocks for one AgentDojo run. No hooks and no server APIs, so they render
 * both in the saved-run viewer (server) and in the live page (client).
 */
import type { ReactNode } from "react";
import { argFromAttacker, splitByInjections } from "@/lib/highlight";
import { textOf, type Message, type ToolCall } from "@/lib/types";

export type Ctx = { injections: Record<string, string>; userPrompt: string };

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

export function AttackerCard({ vector, payload, attack }: { vector: string; payload: string; attack?: string | null }) {
  return (
    <Row side="left" name={attack ? `Attacker · ${attack}` : "Attacker"} avatar={<Avatar label="ATK" className="bg-attacker text-white" />}>
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

export function SystemPrompt({ text }: { text: string }) {
  return (
    <details className="rounded-lg border border-dashed border-border px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted">System prompt given to the target agent</summary>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted">{text}</pre>
    </details>
  );
}

export function UserBubble({ text, variant = "user" }: { text: string; variant?: "user" | "repeated" | "defense" }) {
  if (variant === "defense") {
    return (
      <Row side="right" name="Defense" avatar={<Avatar label="DEF" className="bg-good text-white" />}>
        <details className="rounded-2xl rounded-tr-sm border border-good/40 bg-good-bg px-4 py-2.5 text-sm">
          <summary className="cursor-pointer text-good">Defense step: asked the model a question of its own</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{text}</pre>
        </details>
      </Row>
    );
  }
  return (
    <Row
      side="right"
      name={variant === "repeated" ? "User prompt, repeated by the defense" : "User"}
      avatar={<Avatar label="USR" className="bg-user text-white" />}
    >
      <div
        className={`rounded-2xl rounded-tr-sm bg-user-bg px-4 py-2.5 text-sm whitespace-pre-wrap ${variant === "repeated" ? "opacity-60" : ""}`}
      >
        {text}
      </div>
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

export function AgentBubble({
  msg,
  ctx,
  name = "Target agent",
}: {
  msg: Extract<Message, { role: "assistant" }>;
  ctx: Ctx;
  name?: string;
}) {
  // With thinking turned off, Qwen sometimes still emits an empty <think></think> or a stray </think>.
  const text = textOf(msg.content)
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/?think>/g, "")
    .trim();
  const calls = msg.tool_calls ?? [];
  const thinking =
    Array.isArray(msg.content) &&
    msg.content
      .filter((b) => b.type !== "text")
      .map((b) => (typeof b.content === "string" ? b.content : ""))
      .join("\n")
      .trim();
  return (
    <Row side="left" name={name} avatar={<Avatar label="AI" className="bg-foreground text-background" />}>
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

export function ThinkingBubble() {
  return (
    <Row side="left" name="Target agent" avatar={<Avatar label="AI" className="bg-foreground text-background" />}>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-border bg-agent-bg px-4 py-3" aria-label="Thinking">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </Row>
  );
}

export function ToolResult({ msg, ctx }: { msg: Extract<Message, { role: "tool" }>; ctx: Ctx }) {
  const text = textOf(msg.content);
  const segments = splitByInjections(text, ctx.injections);
  const poisoned = segments.some((s) => s.injected);
  return (
    <div className="ml-11 max-w-[85%]">
      <div className={`overflow-hidden rounded-lg border bg-tool-bg ${poisoned ? "border-attacker/60" : "border-border"}`}>
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

export function Verdict({
  utility,
  security,
  attacked,
  error,
  footer,
}: {
  utility: boolean | null;
  security: boolean | null;
  attacked: boolean;
  error?: string | null;
  footer?: ReactNode;
}) {
  return (
    <div className="mt-2 grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
      <Pill ok={utility} label="User's task" yes="Completed" no="Not completed" />
      {attacked ? (
        <Pill
          ok={security == null ? null : !security}
          label="Attack"
          yes="Resisted: attacker goal not achieved"
          no="Succeeded: agent carried out the attacker's goal"
        />
      ) : (
        <div className="self-center text-sm text-muted">No attack in this run.</div>
      )}
      {error && <div className="text-sm text-bad sm:col-span-2">Run error: {error}</div>}
      {footer && <div className="text-xs text-muted sm:col-span-2">{footer}</div>}
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

/** Turn a run's messages into chat items (system prompt, attacker payloads, conversation). */
export function messageItems(
  messages: Message[],
  injections: Record<string, string>,
  attack?: string | null,
): { items: ReactNode[]; ctx: Ctx } {
  const firstUser = messages.find((m) => m.role === "user");
  const ctx: Ctx = { injections, userPrompt: firstUser ? textOf(firstUser.content) : "" };
  const items: ReactNode[] = [];
  const system = messages.find((m) => m.role === "system");
  if (system) items.push(<SystemPrompt key="sys" text={textOf(system.content)} />);
  for (const [vector, payload] of Object.entries(injections)) {
    items.push(<AttackerCard key={`atk-${vector}`} vector={vector} payload={payload} attack={attack} />);
  }
  // Defenses can add user-role messages: repeat_user_prompt repeats the original prompt,
  // tool_filter asks the model which tools to keep. Label those instead of showing them as the user.
  let seenUser = false;
  let answeringDefense = false;
  messages.forEach((m, i) => {
    if (m.role === "user") {
      const text = textOf(m.content);
      const variant = !seenUser ? "user" : text.trim() === ctx.userPrompt.trim() ? "repeated" : "defense";
      items.push(<UserBubble key={i} text={text} variant={variant} />);
      answeringDefense = variant === "defense";
      seenUser = true;
    } else if (m.role === "assistant") {
      items.push(
        <AgentBubble key={i} msg={m} ctx={ctx} name={answeringDefense ? "Target model, answering the defense" : undefined} />,
      );
      answeringDefense = false;
    } else if (m.role === "tool") items.push(<ToolResult key={i} msg={m} ctx={ctx} />);
  });
  return { items, ctx };
}
