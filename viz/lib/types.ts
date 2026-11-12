/** Types and helpers shared by server code and client components (no Node APIs here). */

export const DEFENSES = [
  "tool_filter",
  "transformers_pi_detector",
  "spotlighting_with_delimiting",
  "repeat_user_prompt",
];

export type ContentBlock = { type: string; content?: string | null; [k: string]: unknown };

export type ToolCall = {
  function: string;
  args: Record<string, unknown>;
  id?: string | null;
};

export type Message =
  | { role: "system" | "user"; content: ContentBlock[] | string | null }
  | { role: "assistant"; content: ContentBlock[] | string | null; tool_calls?: ToolCall[] | null }
  | {
      role: "tool";
      content: ContentBlock[] | string | null;
      tool_call?: ToolCall | null;
      tool_call_id?: string | null;
      error?: string | null;
    };

export type RunLog = {
  suite_name: string;
  pipeline_name: string;
  user_task_id: string;
  injection_task_id: string | null;
  attack_type: string | null;
  injections: Record<string, string>;
  messages: Message[];
  error: string | null;
  utility?: boolean;
  security?: boolean;
  duration?: number;
  evaluation_timestamp?: string;
};

export type RunSummary = {
  /** URL-safe path segments under RUNS_DIR, without the .json extension */
  slug: string[];
  model: string;
  defense: string | null;
  suite: string;
  userTask: string;
  injectionTask: string | null;
  attack: string | null;
  utility: boolean | null;
  attackSucceeded: boolean | null;
  duration: number | null;
  timestamp: string | null;
};

/** pipeline_name is "<model>" or "<model>-<defense>" */
export function splitPipelineName(name: string): { model: string; defense: string | null } {
  for (const d of DEFENSES) {
    if (name.endsWith(`-${d}`)) return { model: name.slice(0, -(d.length + 1)), defense: d };
  }
  return { model: name, defense: null };
}

export function textOf(content: Message["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.content ?? "")
    .join("\n");
}

