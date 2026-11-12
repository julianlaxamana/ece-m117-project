import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { io } from "next/cache";
import { splitPipelineName, type RunLog, type RunSummary } from "./types";

export * from "./types";

/** AgentDojo writes results to ../runs relative to this app (override with RUNS_DIR). */
export const RUNS_DIR = path.resolve(process.env.RUNS_DIR ?? path.join(process.cwd(), "..", "runs"));

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = await Promise.all(
    entries.map((e) => {
      const p = path.join(dir, e.name);
      if (e.name.startsWith(".")) return Promise.resolve([]); // e.g. runs/.live scratch for in-progress live runs
      if (e.isDirectory()) return walk(p);
      return Promise.resolve(e.name.endsWith(".json") ? [p] : []);
    }),
  );
  return out.flat();
}

export async function listRuns(): Promise<RunSummary[]> {
  await io(); // read fresh from disk on every request, never bake into the static shell
  const files = await walk(RUNS_DIR);
  const runs = await Promise.all(
    files.map(async (file): Promise<RunSummary | null> => {
      try {
        const log = JSON.parse(await fs.readFile(file, "utf8")) as RunLog;
        // Skip AgentDojo's "injection task alone" sanity runs: no user task conversation.
        if (!log.user_task_id?.startsWith("user_task")) return null;
        const { model, defense } = splitPipelineName(log.pipeline_name);
        const rel = path.relative(RUNS_DIR, file).replace(/\.json$/, "");
        return {
          slug: rel.split(path.sep),
          model,
          defense,
          suite: log.suite_name,
          userTask: log.user_task_id,
          injectionTask: log.injection_task_id,
          attack: log.attack_type && log.attack_type !== "none" ? log.attack_type : null,
          utility: log.utility ?? null,
          attackSucceeded: log.attack_type && log.attack_type !== "none" ? (log.security ?? null) : null,
          duration: log.duration ?? null,
          timestamp: log.evaluation_timestamp ?? null,
        };
      } catch {
        return null;
      }
    }),
  );
  return runs
    .filter((r): r is RunSummary => r !== null)
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
}

export async function getRun(slug: string[]): Promise<RunLog | null> {
  await io();
  const file = path.resolve(RUNS_DIR, ...slug.map(decodeURIComponent)) + ".json";
  if (!file.startsWith(RUNS_DIR + path.sep)) return null; // no path traversal out of runs/
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as RunLog;
  } catch {
    return null;
  }
}
