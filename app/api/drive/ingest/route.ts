import {
  startDriveWorker,
  getDriveWorkerStatus,
  clearDriveWorkerRuntime,
} from "@/app/lib/server/driveWorker";
import {
  runServerAction,
  runServerMutation,
  runServerQuery,
} from "@/app/lib/server/convex";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [status, connection] = await Promise.all([
      getDriveWorkerStatus(),
      runServerQuery("drive:getDriveConnectionStatus", {}),
    ]);

    const typedConnection = connection as {
      connected: boolean;
      folderId: string | null;
      ingestionEnabled?: boolean;
    };

    if (
      !status.running &&
      typedConnection.connected &&
      typedConnection.folderId &&
      typedConnection.ingestionEnabled
    ) {
      const restarted = await startDriveWorker();
      return Response.json(restarted);
    }

    return Response.json(status);
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

export async function POST() {
  try {
    const connection = (await runServerQuery("drive:getDriveConnectionStatus", {})) as {
      connected: boolean;
      folderId: string | null;
    };

    if (!connection.connected) {
      return new Response(
        JSON.stringify({ error: "Connect Google Drive before starting ingestion." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!connection.folderId) {
      return new Response(
        JSON.stringify({ error: "Choose a Google Drive folder before starting ingestion." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const requested = await runServerMutation("drive:requestDriveIngestionStart", {});
    const worker = await startDriveWorker();

    return Response.json({
      requested,
      worker,
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

export async function DELETE() {
  try {
    const connection = (await runServerQuery("drive:getDriveConnectionStatus", {})) as {
      namespace: string | null;
    };

    const worker = await clearDriveWorkerRuntime();
    await runServerMutation("drive:pauseDriveIngestion", {});

    let resetResult: { namespace: string; deletedProcessedFiles: number } | null = null;

    if (connection.namespace) {
      await runServerAction("ingest:eraseDriveChunks", {
        namespace: connection.namespace,
      });

      resetResult = (await runServerMutation("drive:resetDriveProcessingState", {
        namespace: connection.namespace,
      })) as {
        namespace: string;
        deletedProcessedFiles: number;
      };
    }

    return Response.json({
      cleared: true,
      worker,
      resetResult,
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
