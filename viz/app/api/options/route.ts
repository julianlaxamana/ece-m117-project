import { connection } from "next/server";
import { getOptions } from "@/lib/runner";

export async function GET() {
  await connection(); // runs a subprocess: always at request time, never prerendered
  try {
    return Response.json(await getOptions());
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
