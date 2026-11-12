import type { RunLog } from "@/lib/types";
import { messageItems, Verdict } from "./Bubbles";
import { Replay } from "./Replay";

/** A saved run, rendered as a chat with step-by-step replay. */
export function Chat({ run }: { run: RunLog }) {
  const attacked = !!run.attack_type && run.attack_type !== "none";
  const { items } = messageItems(run.messages, run.injections ?? {}, attacked ? run.attack_type : null);
  items.push(
    <Verdict
      key="verdict"
      utility={run.utility ?? null}
      security={run.security ?? null}
      attacked={attacked}
      error={run.error}
    />,
  );
  return <Replay>{items}</Replay>;
}
