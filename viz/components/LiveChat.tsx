"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Message } from "@/lib/types";
import { messageItems, ThinkingBubble, Verdict } from "./Bubbles";

type Options = {
  suites: Record<string, { user_tasks: { id: string; prompt: string }[]; injection_tasks: { id: string; goal: string }[] }>;
  attacks: string[];
  defenses: string[];
};

type Config = {
  provider: "ollama" | "anthropic" | "openai" | "claude-cli";
  model: string;
  suite: string;
  user_task: string;
  attack: string; // "" = no attack
  injection_task: string;
  defense: string; // "" = no defense
};

type Session = {
  id: number;
  config: Config;
  status: string | null;
  start: { pipeline: string; injections: Record<string, string> } | null;
  messages: Message[];
  thinking: boolean;
  result: { utility: boolean; security: boolean | null; duration: number; log: string } | null;
  error: string | null;
  done: boolean;
};

type RunEvent =
  | { type: "status"; text: string }
  | { type: "start"; pipeline: string; injections: Record<string, string> }
  | { type: "message"; message: Message }
  | { type: "thinking" }
  | { type: "result"; utility: boolean; security: boolean | null; duration: number; log: string }
  | { type: "error"; text: string; detail?: string };

const DEFAULT: Config = {
  provider: "ollama",
  model: "qwen3-8b-16k",
  suite: "banking",
  user_task: "user_task_0",
  attack: "important_instructions",
  injection_task: "injection_task_0",
  defense: "",
};

function applyEvent(s: Session, e: RunEvent): Session {
  switch (e.type) {
    case "status":
      return { ...s, status: e.text };
    case "start":
      return { ...s, start: { pipeline: e.pipeline, injections: e.injections ?? {} }, status: null };
    case "thinking":
      return { ...s, thinking: true };
    case "message":
      return { ...s, messages: [...s.messages, e.message], thinking: e.message.role === "assistant" ? false : s.thinking };
    case "result":
      return { ...s, result: e, thinking: false };
    case "error":
      return { ...s, error: e.detail ? `${e.text}\n${e.detail.trim().split("\n").slice(-6).join("\n")}` : e.text, thinking: false };
  }
}

/** runs/<pipeline>/<suite>/... .json  →  /run/<pipeline>/<suite>/... */
function logHref(log: string) {
  const rel = log.replace(/^.*?runs\//, "").replace(/\.json$/, "");
  return `/run/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function LiveChat() {
  const [opts, setOpts] = useState<Options | null>(null);
  const [optsError, setOptsError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Config>(DEFAULT);
  const [sessions, setSessions] = useState<Session[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const running = sessions.some((s) => !s.done);

  useEffect(() => {
    fetch("/api/options")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? r.statusText);
        setOpts(body as Options);
      })
      .catch((e) => setOptsError(String(e)));
  }, []);

  // Keep the newest step in view while a run streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [sessions]);

  const update = useCallback((id: number, fn: (s: Session) => Session) => {
    setSessions((all) => all.map((s) => (s.id === id ? fn(s) : s)));
  }, []);

  async function run() {
    const id = nextId.current++;
    const config = { ...cfg };
    setSessions((all) => [
      ...all,
      { id, config, status: "Starting…", start: null, messages: [], thinking: false, result: null, error: null, done: false },
    ]);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          provider: config.provider,
          model: config.model,
          suite: config.suite,
          user_task: config.user_task,
          attack: config.attack || null,
          injection_task: config.attack ? config.injection_task : null,
          defense: config.defense || null,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as RunEvent;
            update(id, (s) => applyEvent(s, event));
          } catch {
            // ignore a non-JSON line
          }
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) update(id, (s) => ({ ...s, error: String(e instanceof Error ? e.message : e) }));
      else update(id, (s) => ({ ...s, error: "Run stopped" }));
    } finally {
      update(id, (s) => ({ ...s, done: true, thinking: false, status: null }));
      abortRef.current = null;
    }
  }

  const suite = opts?.suites[cfg.suite];
  const userTask = suite?.user_tasks.find((t) => t.id === cfg.user_task);
  const injTask = suite?.injection_tasks.find((t) => t.id === cfg.injection_task);
  const set = (patch: Partial<Config>) => setCfg((c) => ({ ...c, ...patch }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
          {sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
              <p className="font-medium text-foreground">Run an attack and watch it live</p>
              <p className="mt-1">
                Pick a task, one of AgentDojo&apos;s built-in attacks and optionally a defense below, then press{" "}
                <b>Run</b>. You&apos;ll see the planted payload, every step the target agent takes, and whether the
                attack worked. Each run is also saved and listed on the <Link className="underline" href="/">Runs</Link>{" "}
                page.
              </p>
            </div>
          )}
          {sessions.map((s) => (
            <SessionView key={s.id} s={s} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          {optsError && <p className="mb-2 text-sm text-bad">Couldn&apos;t load AgentDojo options: {optsError}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Suite">
              <Select
                value={cfg.suite}
                disabled={!opts || running}
                onChange={(v) => {
                  const s = opts!.suites[v];
                  set({ suite: v, user_task: s.user_tasks[0].id, injection_task: s.injection_tasks[0].id });
                }}
                options={opts ? Object.keys(opts.suites) : [cfg.suite]}
              />
            </Field>
            <Field label="User task">
              <Select
                value={cfg.user_task}
                disabled={!opts || running}
                onChange={(v) => set({ user_task: v })}
                options={suite?.user_tasks.map((t) => t.id) ?? [cfg.user_task]}
              />
            </Field>
            <Field label="Attack">
              <Select
                value={cfg.attack}
                disabled={!opts || running}
                onChange={(v) => set({ attack: v })}
                options={["", ...(opts?.attacks ?? [cfg.attack])]}
                labels={{ "": "none (no attack)" }}
              />
            </Field>
            <Field label="Attacker goal">
              <Select
                value={cfg.injection_task}
                disabled={!opts || running || !cfg.attack}
                onChange={(v) => set({ injection_task: v })}
                options={suite?.injection_tasks.map((t) => t.id) ?? [cfg.injection_task]}
              />
            </Field>
            <Field label="Defense">
              <Select
                value={cfg.defense}
                disabled={!opts || running}
                onChange={(v) => set({ defense: v })}
                options={["", ...(opts?.defenses ?? [])]}
                labels={{ "": "none" }}
              />
            </Field>
            <Field label="Provider">
              <Select
                value={cfg.provider}
                disabled={running}
                onChange={(v) => set({ provider: v as Config["provider"] })}
                options={["ollama", "anthropic", "openai", "claude-cli"]}
              />
            </Field>
            <Field label="Model" className="col-span-2">
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm disabled:opacity-50"
                value={cfg.model}
                disabled={running}
                onChange={(e) => set({ model: e.target.value })}
                spellCheck={false}
              />
            </Field>
          </div>

          <div className="mt-2 flex items-end gap-3">
            <div className="min-w-0 flex-1 text-xs text-muted">
              {userTask && (
                <p className="truncate" title={userTask.prompt}>
                  <span className="font-semibold text-user">User asks:</span> {userTask.prompt}
                </p>
              )}
              {cfg.attack && injTask && (
                <p className="truncate" title={injTask.goal}>
                  <span className="font-semibold text-attacker">Attacker wants:</span> {injTask.goal}
                </p>
              )}
            </div>
            {running ? (
              <button
                className="rounded-lg border border-bad px-5 py-2 text-sm font-semibold text-bad hover:bg-bad-bg"
                onClick={() => abortRef.current?.abort()}
              >
                ■ Stop
              </button>
            ) : (
              <button
                className="rounded-lg bg-foreground px-5 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40"
                disabled={!opts}
                onClick={run}
              >
                ▶ Run
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionView({ s }: { s: Session }) {
  const attack = s.config.attack || null;
  const { items } = messageItems(s.messages, s.start?.injections ?? {}, attack);
  const elapsed = s.result ? ` · ${s.result.duration.toFixed(1)} s` : "";
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3 py-2 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        <span className="text-center">
          {s.config.suite} / {s.config.user_task}
          {attack && <span className="text-attacker"> + {s.config.injection_task}</span>} · {attack ?? "no attack"} ·{" "}
          {s.config.defense || "no defense"} · <span className="font-mono">{s.config.model}</span>
          {elapsed}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {items.map((it, i) => (
        <div key={i} className="animate-reveal">
          {it as ReactNode}
        </div>
      ))}
      {s.thinking && <ThinkingBubble />}
      {s.status && !s.done && <p className="text-center text-xs text-muted">{s.status}…</p>}
      {s.result && (
        <Verdict
          utility={s.result.utility}
          security={s.result.security}
          attacked={!!attack}
          footer={
            <Link className="underline" href={logHref(s.result.log)}>
              Open saved run
            </Link>
          }
        />
      )}
      {s.error && !s.result && (
        <pre className="whitespace-pre-wrap rounded-lg bg-bad-bg px-3 py-2 text-xs text-bad">{s.error}</pre>
      )}
    </section>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs text-muted ${className}`}>
      {label}
      {children}
    </label>
  );
}

function Select({
  value,
  options,
  onChange,
  disabled,
  labels = {},
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  labels?: Record<string, string>;
}) {
  return (
    <select
      className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o] ?? o}
        </option>
      ))}
    </select>
  );
}
