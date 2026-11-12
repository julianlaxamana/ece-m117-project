import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";

/** The Python project (where stream_run.py and runs/ live). */
export const PROJECT_DIR = path.resolve(process.env.PROJECT_DIR ?? path.join(process.cwd(), ".."));
const UV = process.env.UV_BIN ?? "uv";

export type Options = {
  suites: Record<
    string,
    { user_tasks: { id: string; prompt: string }[]; injection_tasks: { id: string; goal: string }[] }
  >;
  attacks: string[];
  defenses: string[];
};

export type RunConfig = {
  provider: "ollama" | "anthropic" | "openai" | "claude-cli";
  model: string;
  suite: string;
  user_task: string;
  injection_task: string | null;
  attack: string | null;
  defense: string | null;
};

export function spawnRunner(args: string[]) {
  // Arguments are passed as an array (no shell), so user input can't inject commands.
  return spawn(UV, ["run", "python", "-W", "ignore", "stream_run.py", ...args], {
    cwd: PROJECT_DIR,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let optionsPromise: Promise<Options> | null = null;

/** Suites, tasks, attacks and defenses, read once from AgentDojo and cached. */
export function getOptions(): Promise<Options> {
  optionsPromise ??= new Promise<Options>((resolve, reject) => {
    const child = spawnRunner(["options"]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const line = out.split("\n").find((l) => l.includes('"type": "options"'));
      if (code !== 0 || !line) return reject(new Error(`stream_run.py options failed (${code}): ${err.slice(-500)}`));
      resolve(JSON.parse(line) as Options);
    });
  }).catch((e) => {
    optionsPromise = null; // allow a retry after fixing the environment
    throw e;
  });
  return optionsPromise;
}

const MODEL_RE = /^[\w.:\-/]{1,100}$/;

/** Only accept values AgentDojo actually offers. Returns an error message or null. */
export function validate(cfg: RunConfig, opts: Options): string | null {
  if (!["ollama", "anthropic", "openai", "claude-cli"].includes(cfg.provider)) return "unknown provider";
  if (!MODEL_RE.test(cfg.model ?? "")) return "invalid model name";
  const suite = opts.suites[cfg.suite];
  if (!suite) return "unknown suite";
  if (!suite.user_tasks.some((t) => t.id === cfg.user_task)) return "unknown user task";
  if (cfg.attack !== null) {
    if (!opts.attacks.includes(cfg.attack)) return "unknown attack";
    if (!suite.injection_tasks.some((t) => t.id === cfg.injection_task)) return "unknown injection task";
  }
  if (cfg.defense !== null && !opts.defenses.includes(cfg.defense)) return "unknown defense";
  return null;
}
