import Link from "next/link";
import { Suspense } from "react";
import { listRuns, RUNS_DIR, type RunSummary } from "@/lib/runs";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Injection Viewer</h1>
      <p className="mt-1 text-sm text-muted">
        AgentDojo runs: what the attacker planted, what the target agent did, and whether the attack worked.
      </p>
      <Suspense fallback={<p className="mt-8 text-sm text-muted">Loading runs…</p>}>
        <Runs />
      </Suspense>
    </main>
  );
}

const pct = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((100 * n) / d)}%`);

async function Runs() {
  const runs = await listRuns();
  if (runs.length === 0) {
    return (
      <p className="mt-8 text-sm text-muted">
        No runs found in <code className="font-mono">{RUNS_DIR}</code>. Run <code className="font-mono">run_benchmark.py</code>{" "}
        first.
      </p>
    );
  }

  const groups = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const key = [r.model, r.defense ?? "no defense", r.attack ?? "no attack", r.suite].join(" · ");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <>
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Summary</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Defense</th>
              <th className="px-3 py-2 font-medium">Attack</th>
              <th className="px-3 py-2 font-medium">Suite</th>
              <th className="px-3 py-2 text-right font-medium">Runs</th>
              <th className="px-3 py-2 text-right font-medium">Utility</th>
              <th className="px-3 py-2 text-right font-medium">Attack success</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.values()].map((g) => {
              const r = g[0];
              const util = g.filter((x) => x.utility).length;
              const attacked = g.filter((x) => x.attackSucceeded !== null);
              const asr = attacked.filter((x) => x.attackSucceeded).length;
              return (
                <tr key={`${r.model}${r.defense}${r.attack}${r.suite}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                  <td className="px-3 py-2">{r.defense ?? <span className="text-muted">none</span>}</td>
                  <td className="px-3 py-2">{r.attack ?? <span className="text-muted">none</span>}</td>
                  <td className="px-3 py-2">{r.suite}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pct(util, g.length)} <span className="text-xs text-muted">({util}/{g.length})</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {attacked.length ? (
                      <>
                        <span className={asr > 0 ? "text-bad" : "text-good"}>{pct(asr, attacked.length)}</span>{" "}
                        <span className="text-xs text-muted">
                          ({asr}/{attacked.length})
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">All runs</h2>
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {runs.map((r) => (
          <li key={r.slug.join("/")}>
            <Link
              href={`/run/${r.slug.map(encodeURIComponent).join("/")}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-tool-bg"
            >
              <span className="font-medium">
                {r.suite} / {r.userTask}
              </span>
              {r.injectionTask && <span className="text-attacker">+ {r.injectionTask}</span>}
              <span className="text-xs text-muted">
                {r.model}
                {r.defense ? ` · ${r.defense}` : ""}
                {r.attack ? ` · ${r.attack}` : ""}
              </span>
              <span className="ml-auto flex gap-1.5">
                {r.utility === null && (
                  <span className="rounded-full bg-tool-bg px-2 py-0.5 text-xs text-muted">running…</span>
                )}
                <Badge ok={r.utility} yes="task done" no="task failed" />
                {r.attackSucceeded !== null && <Badge ok={!r.attackSucceeded} yes="resisted" no="hijacked" />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Badge({ ok, yes, no }: { ok: boolean | null; yes: string; no: string }) {
  if (ok == null) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${ok ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>
      {ok ? yes : no}
    </span>
  );
}
