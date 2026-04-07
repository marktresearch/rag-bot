import { ensureDatasetReady } from "@/app/lib/server/dataset";

export async function POST() {
  try {
    const result = await ensureDatasetReady();
    return Response.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
