import { runServerQuery } from "@/app/lib/server/convex";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const namespace = url.searchParams.get("namespace");

    if (!namespace) {
      return new Response(
        JSON.stringify({ error: "namespace is required." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const progress = await runServerQuery("drive:getDriveIngestionProgress", {
      namespace,
    });

    return Response.json(progress);
  } catch (caughtError: unknown) {
    return new Response(
      JSON.stringify({
        error: caughtError instanceof Error ? caughtError.message : String(caughtError),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}
