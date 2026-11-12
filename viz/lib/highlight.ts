/**
 * Locating attacker text inside tool outputs.
 *
 * AgentDojo reformats whitespace when it plants an injection (e.g. blank lines collapse
 * when the environment is dumped to YAML), so an exact substring search misses it.
 * We match the injection's words in order, allowing any whitespace between them.
 */

export type Segment = { text: string; injected: false } | { text: string; injected: true; vector: string };

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function injectionPattern(injection: string): RegExp | null {
  const words = injection.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return new RegExp(words.map(escapeRegExp).join("\\s+"), "g");
}

export function splitByInjections(text: string, injections: Record<string, string>): Segment[] {
  const hits: { start: number; end: number; vector: string }[] = [];
  for (const [vector, inj] of Object.entries(injections)) {
    const re = injectionPattern(inj);
    if (!re) continue;
    for (const m of text.matchAll(re)) {
      hits.push({ start: m.index, end: m.index + m[0].length, vector });
    }
  }
  hits.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start < pos) continue; // overlapping match; keep the first
    if (h.start > pos) segments.push({ text: text.slice(pos, h.start), injected: false });
    segments.push({ text: text.slice(h.start, h.end), injected: true, vector: h.vector });
    pos = h.end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), injected: false });
  return segments;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Is this tool-call argument value something the agent could only have gotten from the
 * attacker? True when the value appears in an injection but NOT in the user's request.
 * This is a rough provenance signal for the viewer, not a security check.
 */
export function argFromAttacker(value: unknown, injections: Record<string, string>, userPrompt: string): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const v = normalize(String(value));
  if (v.length < 4) return false; // too short to be meaningful ("yes", "10")
  if (normalize(userPrompt).includes(v)) return false;
  return Object.values(injections).some((inj) => normalize(inj).includes(v));
}
