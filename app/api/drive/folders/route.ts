import { runServerQuery } from "@/app/lib/server/convex";
import {
  decryptRefreshToken,
  listDriveFolders,
  refreshGoogleAccessToken,
} from "@/shared/driveOAuth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parentId = url.searchParams.get("parentId");
    const query = url.searchParams.get("query");
    const connection = (await runServerQuery("drive:getDriveConnectionAuth", {})) as {
      encryptedRefreshToken: string;
    } | null;

    if (!connection?.encryptedRefreshToken) {
      return new Response(
        JSON.stringify({ error: "Google Drive is not connected." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const refreshToken = decryptRefreshToken(connection.encryptedRefreshToken);
    const token = await refreshGoogleAccessToken({ refreshToken });
    const folders = await listDriveFolders({
      accessToken: token.access_token,
      parentId,
      query,
    });

    return Response.json({
      folders,
      parentId,
      query,
    });
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
