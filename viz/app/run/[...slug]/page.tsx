import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Chat } from "@/components/Chat";
import { getRun, splitPipelineName } from "@/lib/runs";

export default function RunPage({ params }: PageProps<"/run/[...slug]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← All runs
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-muted">Loading run…</p>}>
        <Run params={params} />
      </Suspense>
    </main>
  );
}

async function Run({ params }: { params: PageProps<"/run/[...slug]">["params"] }) {
  const { slug } = await params;
  const run = await getRun(slug);
  if (!run) notFound();
  const { model, defense } = splitPipelineName(run.pipeline_name);
  const attacked = run.attack_type && run.attack_type !== "none";

  return (
    <>
      <header className="mt-3 mb-5">
        <h1 className="text-xl font-semibold">
          {run.suite_name} / {run.user_task_id}
          {attacked && run.injection_task_id && <span className="text-attacker"> + {run.injection_task_id}</span>}
        </h1>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <Meta k="Target model" v={model} />
          <Meta k="Defense" v={defense ?? "none"} />
          <Meta k="Attack" v={attacked ? run.attack_type! : "none"} />
          {run.duration != null && <Meta k="Duration" v={`${run.duration.toFixed(1)} s`} />}
        </dl>
        <Legend />
      </header>
      <Chat run={run} />
    </>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1">
      <dt>{k}:</dt>
      <dd className="font-mono text-foreground">{v}</dd>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-attacker" /> Attacker text
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-user" /> User
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-foreground" /> Target agent
      </span>
      <span className="flex items-center gap-1.5">
        <span className="rounded bg-attacker-soft px-1 text-attacker underline decoration-wavy">value</span> Tool argument
        taken from the attacker&apos;s payload
      </span>
    </div>
  );
}
