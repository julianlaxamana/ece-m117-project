"use client";

import { Children, useEffect, useState, type ReactNode } from "react";

/**
 * Shows the conversation all at once, or step by step (handy for presenting).
 * Children are the already-rendered chat items, one per step.
 */
export function Replay({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const [shown, setShown] = useState(items.length);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || shown >= items.length) return;
    const t = setTimeout(() => {
      setShown(shown + 1);
      if (shown + 1 >= items.length) setPlaying(false);
    }, 1100);
    return () => clearTimeout(t);
  }, [playing, shown, items.length]);

  const done = shown >= items.length;

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-border bg-background/90 px-4 py-2 backdrop-blur">
        <button
          className="rounded-md border border-border bg-surface px-3 py-1 text-sm hover:bg-tool-bg"
          onClick={() => {
            setShown(1);
            setPlaying(true);
          }}
        >
          ▶ Replay
        </button>
        <button
          className="rounded-md border border-border bg-surface px-3 py-1 text-sm hover:bg-tool-bg disabled:opacity-40"
          disabled={done}
          onClick={() => {
            setPlaying(false);
            setShown((n) => Math.min(n + 1, items.length));
          }}
        >
          Next step
        </button>
        <button
          className="rounded-md border border-border bg-surface px-3 py-1 text-sm hover:bg-tool-bg disabled:opacity-40"
          disabled={done}
          onClick={() => {
            setPlaying(false);
            setShown(items.length);
          }}
        >
          Show all
        </button>
        <span className="ml-auto text-xs text-muted tabular-nums">
          step {Math.min(shown, items.length)} / {items.length}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {items.slice(0, shown).map((item, i) => (
          <div key={i} className={playing || i >= items.length - 1 ? "animate-reveal" : undefined}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
