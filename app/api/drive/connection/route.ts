import { runServerMutation, runServerQuery } from "@/app/lib/server/convex";

export async function GET() {
  try {
    const connection = await runServerQuery("drive:getDriveConnectionStatus", {});
    return Response.json(connection);
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

export async function DELETE() {
  try {
    const result = await runServerMutation("drive:clearDriveConnection", {});
    return Response.json(result);
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
