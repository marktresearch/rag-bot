import { runServerMutation } from "@/app/lib/server/convex";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      folderId?: string;
      folderName?: string;
    };

    if (!body.folderId || !body.folderName) {
      return new Response(
        JSON.stringify({ error: "folderId and folderName are required." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const result = await runServerMutation("drive:selectDriveFolder", {
      folderId: body.folderId,
      folderName: body.folderName,
    });

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
