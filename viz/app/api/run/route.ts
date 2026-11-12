import { getOptions, spawnRunner, validate, type RunConfig } from "@/lib/runner";

// The local model can only serve one agent at a time, so allow one run at once.
let busy = false;

/**
 * Starts one AgentDojo run and streams its events back as newline-delimited JSON
 * (the same lines stream_run.py prints). Closing the request stops the run.
 */
export async function POST(request: Request) {
  const cfg = (await request.json()) as RunConfig;
  const opts = await getOptions();
  const problem = validate(cfg, opts);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (busy) return Response.json({ error: "A run is already in progress" }, { status: 409 });
  busy = true;

  const child = spawnRunner(["run", JSON.stringify(cfg)]);
  let stderrTail = "";
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  request.signal.addEventListener("abort", stop);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: object) => controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
      child.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });
      child.on("error", (e) => send({ type: "error", text: `Could not start runner: ${e.message}` }));
      child.on("close", (code, signal) => {
        busy = false;
        if (signal) send({ type: "error", text: "Run stopped" });
        else if (code !== 0) send({ type: "error", text: `Runner exited with code ${code}`, detail: stderrTail });
        try {
          controller.close();
        } catch {
          // already closed because the client went away
        }
      });
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
